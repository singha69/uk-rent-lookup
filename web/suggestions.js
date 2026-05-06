// suggestions.js — debounced typeahead for the rent lookup input.
// Exports attachSuggestions(input, onPick).
// Every suggestion carries a real UK full postcode in `data-postcode`.
// onPick receives { display, postcode } — the existing /lookup?postcode= path
// resolves the area code via postcodes.io (same as a typed search).

const DEBOUNCE_MS = 200;
const FETCH_TIMEOUT_MS = 2000;
const MIN_QUERY_LEN = 2;
const MAX_POSTCODE_RESULTS = 1;   // /postcodes/{prefix}/autocomplete only varies in incode for one outward — show 1 row per prefix
const MAX_PLACE_RESULTS = 5;
const TOTAL_MAX = 6;

const URL_AUTOCOMPLETE = (q) =>
  `https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete`;
const URL_OUTCODE = (q) =>
  `https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`;
const URL_PLACES = (q) =>
  `https://api.postcodes.io/places?q=${encodeURIComponent(q)}&limit=10`;

// Page-lifetime caches keyed by query / outcode.
const OUTCODE_NAME_CACHE = new Map(); // outcode -> LA name (or null if not found)
const OUTCODE_POSTCODE_CACHE = new Map(); // outcode -> first full postcode (or null)

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function looksLikePostcodePrefix(q) {
  // 1-2 letters then a digit (e.g. "IG1", "SW1A", "M1") — the postcode shape.
  return /^[A-Z]{1,2}\d/i.test(q);
}

async function fetchJson(url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => ctrl.abort());
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getOutcodeName(outcode, signal) {
  if (OUTCODE_NAME_CACHE.has(outcode)) return OUTCODE_NAME_CACHE.get(outcode);
  const data = await fetchJson(URL_OUTCODE(outcode), signal);
  const name = data?.result?.admin_district?.[0] ?? null;
  OUTCODE_NAME_CACHE.set(outcode, name);
  return name;
}

async function getOutcodeFirstPostcode(outcode, signal) {
  if (OUTCODE_POSTCODE_CACHE.has(outcode)) return OUTCODE_POSTCODE_CACHE.get(outcode);
  const data = await fetchJson(URL_AUTOCOMPLETE(outcode), signal);
  const first = Array.isArray(data?.result) && data.result.length > 0 ? data.result[0] : null;
  OUTCODE_POSTCODE_CACHE.set(outcode, first);
  return first;
}

async function getPostcodeSuggestion(query, signal) {
  // Postcode-shape input: produce one suggestion row for the input's outward code.
  if (!looksLikePostcodePrefix(query)) return [];
  const data = await fetchJson(URL_AUTOCOMPLETE(query), signal);
  const arr = Array.isArray(data?.result) ? data.result : [];
  if (arr.length === 0) return [];
  const fullPostcode = arr[0];
  const outcode = fullPostcode.split(/\s+/)[0].toUpperCase();
  // Cache the first postcode under the outcode (cheap optimisation).
  OUTCODE_POSTCODE_CACHE.set(outcode, fullPostcode);
  const laName = await getOutcodeName(outcode, signal);
  return [{
    kind: "postcode",
    display: outcode,
    secondary: laName ?? "",
    postcode: fullPostcode,
  }];
}

async function getPlaceSuggestions(query, signal) {
  const data = await fetchJson(URL_PLACES(query), signal);
  const arr = Array.isArray(data?.result) ? data.result : [];
  // Prefer entries with district_borough_type populated (real urban LAs);
  // fall through to county_unitary entries when nothing better is available.
  const ranked = [...arr].sort((a, b) => {
    const aHas = !!a.district_borough_type;
    const bHas = !!b.district_borough_type;
    return (bHas ? 1 : 0) - (aHas ? 1 : 0);
  });
  // Filter out entries with no usable outcode.
  const withOutcode = ranked.filter((p) => !!p.outcode);
  return withOutcode.slice(0, MAX_PLACE_RESULTS).map((p) => ({
    kind: "place",
    display: p.name_1 ?? "",
    secondary: p.district_borough || p.county_unitary || p.region || "",
    outcode: p.outcode,            // resolved on click
    postcode: null,                // not yet known; resolveOnPick handles it
  }));
}

function renderRow(s, index, highlighted) {
  const icon = s.kind === "postcode" ? "⌖" : "◎";
  const cls = "suggestion" + (highlighted ? " highlighted" : "");
  return `
    <li role="option" id="sug-${index}" class="${cls}"
        aria-selected="${highlighted}"
        data-index="${index}">
      <span class="sug-icon" aria-hidden="true">${icon}</span>
      <span class="sug-primary">${escapeHtml(s.display)}</span>
      <span class="sug-secondary">${escapeHtml(s.secondary)}</span>
    </li>
  `;
}

export function attachSuggestions(input, onPick) {
  const list = document.getElementById("suggestions");
  if (!list) throw new Error("attachSuggestions: #suggestions element not found");

  let suggestions = [];
  let highlightedIndex = -1;
  let pageController = null;
  let debounceTimer = null;

  function close() {
    suggestions = [];
    highlightedIndex = -1;
    list.innerHTML = "";
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function render() {
    if (suggestions.length === 0) { close(); return; }
    list.innerHTML = suggestions.map((s, i) => renderRow(s, i, i === highlightedIndex)).join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (highlightedIndex >= 0) {
      input.setAttribute("aria-activedescendant", `sug-${highlightedIndex}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  async function refresh(query) {
    if (pageController) pageController.abort();
    pageController = new AbortController();
    const signal = pageController.signal;
    // Always call BOTH endpoints; cheap, and ambiguous queries benefit from both.
    const [postcodeRows, placeRows] = await Promise.all([
      getPostcodeSuggestion(query, signal),
      getPlaceSuggestions(query, signal),
    ]);
    if (signal.aborted) return;
    suggestions = [...postcodeRows, ...placeRows].slice(0, TOTAL_MAX);
    highlightedIndex = -1;
    render();
  }

  async function pick(index) {
    const s = suggestions[index];
    if (!s) return;
    let postcode = s.postcode;
    // Place suggestions resolve their full postcode lazily.
    if (!postcode && s.outcode) {
      postcode = await getOutcodeFirstPostcode(s.outcode);
    }
    if (!postcode) {
      // Last-ditch fallback: hand back the display string and let the form-submit path try.
      input.value = s.display;
      close();
      return;
    }
    input.value = s.display;
    close();
    onPick({ display: s.display, postcode });
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < MIN_QUERY_LEN) { close(); return; }
    debounceTimer = setTimeout(() => refresh(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % suggestions.length;
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIndex = (highlightedIndex - 1 + suggestions.length) % suggestions.length;
      render();
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      pick(highlightedIndex);
    } else if (e.key === "Escape" || e.key === "Tab") {
      close();
    }
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li.suggestion");
    if (!li) return;
    pick(Number(li.dataset.index));
  });

  document.addEventListener("click", (e) => {
    if (!list.contains(e.target) && e.target !== input) close();
  });
}
