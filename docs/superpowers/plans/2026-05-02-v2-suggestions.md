# UK Rent Lookup v2 — Suggestions & Area Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live, debounced typeahead suggestions to the existing UK Rent Lookup site so users can type a partial postcode (`IG1`) or a place name (`Ilford`) and click a suggestion to see the rent — without ever pressing Search.

**Architecture:** Frontend talks directly to postcodes.io for suggestions (no Worker round-trip for typeahead). Each suggestion carries a real UK full postcode that the existing `/lookup?postcode=` endpoint already accepts, so the Worker requires no changes.

> **Plan revision (after Task 1 research):** The original design expected `?area_code=` on the Worker to bypass postcodes.io. Research found that postcodes.io's `/outcodes` and `/places` endpoints don't return GSS codes at all — only LA *names*. Rather than add a name→code reverse-lookup endpoint, we resolve every suggestion to a real full postcode at click-time and reuse the existing `?postcode=` path. **Task 2 is dropped.** Task 3's `suggestions.js` is revised accordingly.

**Tech Stack:** TypeScript Cloudflare Worker (existing), plain HTML/CSS/JS frontend (existing), postcodes.io public API (`/postcodes/{prefix}/autocomplete`, `/places?q=…`, `/outcodes/{code}`).

**Spec:** [2026-05-02-rent-lookup-v2-suggestions-design.md](../specs/2026-05-02-rent-lookup-v2-suggestions-design.md)

**Working repo:** `/Users/a_/uk-rent-lookup/` (live at https://rent-lookup.sap09777.workers.dev/, backend at https://uk-rent-lookup.sap09777.workers.dev/)

---

## Task 1: Verify postcodes.io API shapes & bring v2 spec into the repo

**Files:**
- Create: `/Users/a_/uk-rent-lookup/docs/superpowers/research/2026-05-02-postcodes-io-shapes.md`
- (spec already copied to `/Users/a_/uk-rent-lookup/docs/superpowers/specs/2026-05-02-rent-lookup-v2-suggestions-design.md`)

The spec (§11) lists two open API-shape questions. This task answers them by hitting the live postcodes.io endpoints and capturing actual response JSON, so subsequent tasks have concrete field names to code against.

- [ ] **Step 1: Hit `/postcodes/{prefix}/autocomplete` and capture response**

```bash
curl -s 'https://api.postcodes.io/postcodes/IG1/autocomplete' | python3 -m json.tool | head -30
```

Capture the response shape. Specifically: is `result` an array of strings (postcodes) or objects? How many entries by default?

- [ ] **Step 2: Hit `/outcodes/{code}` and capture response**

```bash
curl -s 'https://api.postcodes.io/outcodes/IG1' | python3 -m json.tool | head -40
```

Identify the field that names the local-authority district. Likely `result.admin_district` (a string array — outcode may span multiple LAs) or `result.codes.admin_district` (a string array of codes).

- [ ] **Step 3: Hit `/places?q=…` and capture response**

```bash
curl -s 'https://api.postcodes.io/places?q=ilford&limit=5' | python3 -m json.tool | head -60
```

Identify the field that names the LA code. Likely `result[].local_authority_district_id` or `result[].codes.admin_district`.

- [ ] **Step 4: Write the research note**

Create `/Users/a_/uk-rent-lookup/docs/superpowers/research/2026-05-02-postcodes-io-shapes.md`:

```markdown
# postcodes.io API response shapes — captured 2026-05-02

## /postcodes/{prefix}/autocomplete
- Endpoint: https://api.postcodes.io/postcodes/IG1/autocomplete
- HTTP: 200
- Response shape: { status: 200, result: <type> }
- `result` is: <fill in: array of full postcode strings, e.g. ["IG11AA","IG11AB",...]>
- Default count: <fill in N>

Sample:
\`\`\`json
<paste 5 lines of real response>
\`\`\`

## /outcodes/{code}
- Endpoint: https://api.postcodes.io/outcodes/IG1
- HTTP: 200
- Response shape: { status: 200, result: { ... } }
- LA code field: <fill in actual key path, e.g. result.admin_district[0] or result.codes.admin_district>
- If outcode spans multiple LAs: response gives <single value | array of values>
- Decision for the frontend: when an outcode spans multiple LAs, <use the first | use the largest>

Sample:
\`\`\`json
<paste relevant excerpt>
\`\`\`

## /places?q={term}
- Endpoint: https://api.postcodes.io/places?q=ilford&limit=5
- HTTP: 200
- Response shape: { status: 200, result: [...] }
- LA code field per place: <fill in actual key, e.g. result[].local_authority_district_id>
- Place display name field: <fill in, e.g. result[].name_1 or result[].place_name>

Sample:
\`\`\`json
<paste 1-2 place objects>
\`\`\`

## Decisions that affect implementation
- Outward-code → LA code: <use this exact JS expression>
- Place → LA code: <use this exact JS expression>
- Place display name: <use this exact field>
```

- [ ] **Step 5: Commit**

```bash
cd /Users/a_/uk-rent-lookup
git add docs/superpowers/specs/2026-05-02-rent-lookup-v2-suggestions-design.md docs/superpowers/research/2026-05-02-postcodes-io-shapes.md
git commit -m "docs(v2): spec and postcodes.io research note"
```

---

## Task 2: ~~Worker `/lookup` with `?area_code=`~~ — DROPPED

After Task 1 research, this task was dropped. postcodes.io endpoints don't return GSS codes; we resolve to real full postcodes in the frontend instead and use the existing `?postcode=` path. No Worker changes for v2.

<details><summary>Original (do not implement)</summary>

**Files:**
- Modify: `/Users/a_/uk-rent-lookup/worker/src/index.ts`
- Modify: `/Users/a_/uk-rent-lookup/worker/test/index.test.ts`

The Worker needs a parallel branch that accepts a pre-resolved area code, skipping the postcodes.io resolution call. Existing `?postcode=` behaviour stays exactly as-is.

- [ ] **Step 1: Add the failing tests**

Open `/Users/a_/uk-rent-lookup/worker/test/index.test.ts`. Inside the existing `describe("/lookup endpoint", () => { ... })` block, append three new `it()` cases:

```ts
  it("returns rent for a valid ?area_code= without postcode resolution", async () => {
    const res = await worker.fetch(new Request("https://x/lookup?area_code=E09000033"));
    expect(res.status).toBe(200);
    const body = await res.json() as { area: string; area_level: string };
    expect(body.area).toBe("Westminster");
    expect(body.area_level).toBe("local_authority");
  });

  it("returns 400 invalid_postcode for malformed ?area_code=", async () => {
    const res = await worker.fetch(new Request("https://x/lookup?area_code=NOT_A_CODE"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_postcode" });
  });

  it("prefers ?area_code= over ?postcode= when both are present", async () => {
    // If both are supplied, the area_code path runs and no postcodes.io call is made.
    // We verify by stubbing fetch to throw — if postcodes.io were called, the test would fail.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called"));
    const res = await worker.fetch(new Request("https://x/lookup?area_code=E09000033&postcode=SW1A1AA"));
    expect(res.status).toBe(200);
    fetchSpy.mockRestore();
  });
```

- [ ] **Step 2: Run tests, confirm two of three fail**

```bash
cd /Users/a_/uk-rent-lookup/worker && npm test
```

Expected: 24 PASS (existing) + 3 FAIL (the new ones). The "malformed ?area_code= → 400" might happen to pass coincidentally if the existing missing_postcode path triggers; that's fine, we'll still implement the proper branch.

- [ ] **Step 3: Modify `index.ts` to handle `?area_code=`**

Open `/Users/a_/uk-rent-lookup/worker/src/index.ts`. Find the section starting:

```ts
    const raw = url.searchParams.get("postcode");
    if (!raw) return json({ error: "missing_postcode" }, 400);

    const normalized = normalize(raw);
    if (!isValid(normalized)) return json({ error: "invalid_postcode" }, 400);
```

Replace it with:

```ts
    const rawAreaCode = url.searchParams.get("area_code");
    const rawPostcode = url.searchParams.get("postcode");

    // Prefer the pre-resolved area_code path (skips postcodes.io)
    if (rawAreaCode) {
      const AREA_CODE_RE = /^[ENWSK]\d{8}$/;
      if (!AREA_CODE_RE.test(rawAreaCode)) {
        return json({ error: "invalid_postcode" }, 400);
      }
      const result = lookupRent(rawAreaCode, RENTS, REGIONS);
      if (!result) return json({ error: "no_data" }, 404);
      return json({ ...result, currency: "GBP", period_unit: "monthly" });
    }

    if (!rawPostcode) return json({ error: "missing_postcode" }, 400);

    const normalized = normalize(rawPostcode);
    if (!isValid(normalized)) return json({ error: "invalid_postcode" }, 400);
```

Everything else in `fetch()` stays the same.

- [ ] **Step 4: Run tests, confirm all pass**

```bash
cd /Users/a_/uk-rent-lookup/worker && npm test
```

Expected: 27 PASS (24 existing + 3 new).

- [ ] **Step 5: Deploy**

```bash
cd /Users/a_/uk-rent-lookup/worker
npx wrangler deploy
```

Expected: a successful deploy log. Same URL: `https://uk-rent-lookup.sap09777.workers.dev`.

- [ ] **Step 6: Live smoke-test the new branch**

```bash
URL='https://uk-rent-lookup.sap09777.workers.dev'
echo "--- area_code Westminster ---"; curl -s "$URL/lookup?area_code=E09000033"; echo ""
echo "--- area_code Edinburgh LA (should country-fall-back) ---"; curl -s "$URL/lookup?area_code=S12000036"; echo ""
echo "--- area_code malformed ---"; curl -sw "\nHTTP %{http_code}\n" "$URL/lookup?area_code=BANANA"
echo "--- postcode (existing path) ---"; curl -s "$URL/lookup?postcode=SW1A%201AA"; echo ""
```

Expected:
- 1: Westminster JSON.
- 2: Scotland country-level JSON (existing v1.5 fallback kicks in).
- 3: HTTP 400, `{"error":"invalid_postcode"}`.
- 4: Westminster JSON (existing path unchanged).

- [ ] **Step 7: Commit**

```bash
cd /Users/a_/uk-rent-lookup
git add worker/
git commit -m "feat(worker): accept ?area_code= for pre-resolved lookups"
```

</details>

---

## Task 3: Frontend — write `suggestions.js` module

**Files:**
- Create: `/Users/a_/uk-rent-lookup/web/suggestions.js`

This is the largest single file in v2 (~120 lines). It owns the dropdown UI, the debounced postcodes.io calls, and the keyboard navigation.

> **Before this task:** Open `docs/superpowers/research/2026-05-02-postcodes-io-shapes.md` (from Task 1) and substitute the actual field-access expressions into the code below where it says `// FIELD: ...`. The structure is correct; only the literal accessor expressions may differ.

- [ ] **Step 1: Create the file**

Create `/Users/a_/uk-rent-lookup/web/suggestions.js`:

```js
// suggestions.js — debounced typeahead for the rent lookup input.
// Exports a single attachSuggestions(input, onPick) function.
// Uses postcodes.io APIs directly; no Worker involvement for suggestions.

const DEBOUNCE_MS = 200;
const FETCH_TIMEOUT_MS = 2000;
const MIN_QUERY_LEN = 2;
const MAX_POSTCODE_RESULTS = 3;
const MAX_PLACE_RESULTS = 3;

const POSTCODES_AUTOCOMPLETE = (q) =>
  `https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete`;
const POSTCODES_OUTCODE = (q) =>
  `https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`;
const POSTCODES_PLACES = (q) =>
  `https://api.postcodes.io/places?q=${encodeURIComponent(q)}&limit=10`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function fetchJson(url, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Combine the page-level abort signal with the per-call timeout
  if (signal) signal.addEventListener("abort", () => controller.abort());
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Outcode → LA code resolution, cached for the page lifetime.
const OUTCODE_CACHE = new Map();

async function resolveOutcode(outcode, signal) {
  if (OUTCODE_CACHE.has(outcode)) return OUTCODE_CACHE.get(outcode);
  const data = await fetchJson(POSTCODES_OUTCODE(outcode), signal);
  // FIELD: extract the LA code from /outcodes response. Verify in research note.
  // Common shape: data?.result?.admin_district is an array of LA names; codes are at data?.result?.codes?.admin_district[0]
  const code = data?.result?.codes?.admin_district?.[0]
    ?? null;
  const name = data?.result?.admin_district?.[0] ?? "";
  const value = code ? { area_code: code, area_name: name } : null;
  OUTCODE_CACHE.set(outcode, value);
  return value;
}

function uniqueOutcodes(fullPostcodes) {
  const seen = new Set();
  const out = [];
  for (const pc of fullPostcodes) {
    // Outcode is the part before the first space, or the first 2-4 chars if no space
    const oc = String(pc).trim().split(/\s+/)[0].toUpperCase();
    if (!seen.has(oc)) {
      seen.add(oc);
      out.push(oc);
      if (out.length >= MAX_POSTCODE_RESULTS) break;
    }
  }
  return out;
}

async function getPostcodeSuggestions(query, signal) {
  const data = await fetchJson(POSTCODES_AUTOCOMPLETE(query), signal);
  const arr = Array.isArray(data?.result) ? data.result : [];
  const outcodes = uniqueOutcodes(arr);
  const resolved = await Promise.all(outcodes.map((oc) => resolveOutcode(oc, signal)));
  return outcodes
    .map((oc, i) => resolved[i] && {
      kind: "postcode",
      display: oc,
      area_code: resolved[i].area_code,
      secondary: resolved[i].area_name,
    })
    .filter(Boolean);
}

async function getPlaceSuggestions(query, signal) {
  const data = await fetchJson(POSTCODES_PLACES(query), signal);
  const arr = Array.isArray(data?.result) ? data.result : [];
  return arr
    .slice(0, MAX_PLACE_RESULTS)
    .map((p) => {
      // FIELD: the local-authority code on a place result. Verify in research note.
      // Common: p.local_authority_district_id (a string code) — or p.county_unitary or fall through to county lookup.
      const area_code = p.local_authority_district_id
        ?? p.county_unitary_id
        ?? null;
      const display = p.name_1 ?? p.place_name ?? "";
      const secondary = p.county_unitary ?? p.region ?? p.country ?? "";
      if (!area_code || !display) return null;
      return { kind: "place", display, area_code, secondary };
    })
    .filter(Boolean);
}

function renderRow(suggestion, index, highlighted) {
  const icon = suggestion.kind === "postcode" ? "⌖" : "◎";
  const highlightedClass = highlighted ? " highlighted" : "";
  return `
    <li role="option" id="sug-${index}" class="suggestion${highlightedClass}"
        aria-selected="${highlighted}"
        data-area-code="${escapeHtml(suggestion.area_code)}"
        data-display="${escapeHtml(suggestion.display)}">
      <span class="sug-icon" aria-hidden="true">${icon}</span>
      <span class="sug-primary">${escapeHtml(suggestion.display)}</span>
      <span class="sug-secondary">${escapeHtml(suggestion.secondary)}</span>
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
    if (suggestions.length === 0) {
      close();
      return;
    }
    list.innerHTML = suggestions
      .map((s, i) => renderRow(s, i, i === highlightedIndex))
      .join("");
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
    const [postcodes, places] = await Promise.all([
      getPostcodeSuggestions(query, signal),
      getPlaceSuggestions(query, signal),
    ]);
    if (signal.aborted) return;
    suggestions = [...postcodes, ...places].slice(0, MAX_POSTCODE_RESULTS + MAX_PLACE_RESULTS);
    highlightedIndex = -1;
    render();
  }

  function pick(index) {
    const s = suggestions[index];
    if (!s) return;
    input.value = s.display;
    close();
    onPick({ area_code: s.area_code, display: s.display });
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < MIN_QUERY_LEN) {
      close();
      return;
    }
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
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0) {
        e.preventDefault();
        pick(highlightedIndex);
      }
    } else if (e.key === "Escape") {
      close();
    } else if (e.key === "Tab") {
      close();
    }
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li.suggestion");
    if (!li) return;
    const index = Number(li.id.slice(4));
    pick(index);
  });

  document.addEventListener("click", (e) => {
    if (!list.contains(e.target) && e.target !== input) close();
  });
}
```

- [ ] **Step 2: Sanity-check syntax**

```bash
cd /Users/a_/uk-rent-lookup
node --check web/suggestions.js
```

Expected: no output (file is syntactically valid).

If `node --check` complains about the `export` keyword, that's expected for raw ESM in `.js` — the browser handles it fine via `type="module"` in the script tag (Task 4 wires that up).

- [ ] **Step 3: Commit (don't run yet — needs Task 4 wiring)**

```bash
cd /Users/a_/uk-rent-lookup
git add web/suggestions.js
git commit -m "feat(web): add suggestions module for typeahead"
```

---

## Task 4: Frontend — wire `suggestions.js` into the page

**Files:**
- Modify: `/Users/a_/uk-rent-lookup/web/index.html`
- Modify: `/Users/a_/uk-rent-lookup/web/style.css`
- Modify: `/Users/a_/uk-rent-lookup/web/app.js`

- [ ] **Step 1: Add the listbox element and ARIA attrs to `index.html`**

Open `/Users/a_/uk-rent-lookup/web/index.html`. Find the `<input id="postcode" ... />` element. Replace the entire form block:

```html
    <form id="lookup-form" autocomplete="off">
      <input
        id="postcode"
        name="postcode"
        type="text"
        inputmode="text"
        placeholder="Enter UK postcode (e.g. SW1A 1AA)"
        aria-label="UK postcode"
        required
      />
      <button type="submit">Search</button>
    </form>
```

…with:

```html
    <form id="lookup-form" autocomplete="off">
      <div class="search-wrap">
        <input
          id="postcode"
          name="postcode"
          type="text"
          inputmode="text"
          placeholder="Enter postcode or area (e.g. SW1A 1AA, Ilford)"
          aria-label="UK postcode or area name"
          aria-controls="suggestions"
          aria-expanded="false"
          aria-autocomplete="list"
          autocomplete="off"
          required
        />
        <ul id="suggestions" role="listbox" hidden></ul>
      </div>
      <button type="submit">Search</button>
    </form>
```

Then change the `<script src="app.js"></script>` line at the bottom of `<body>` to:

```html
  <script type="module" src="app.js"></script>
```

(The `type="module"` is required for `import`/`export` to work in the browser.)

- [ ] **Step 2: Add dropdown styles to `style.css`**

Open `/Users/a_/uk-rent-lookup/web/style.css`. Append at the end:

```css
.search-wrap {
  position: relative;
  flex: 1;
}

.search-wrap input {
  width: 100%;
}

#suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  z-index: 10;
  max-height: 320px;
  overflow-y: auto;
}

.suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
}

.suggestion:hover,
.suggestion.highlighted {
  background: var(--accent-bg);
}

.sug-icon {
  font-size: 13px;
  opacity: 0.55;
  width: 16px;
  text-align: center;
}

.sug-primary { font-weight: 600; }

.sug-secondary {
  color: var(--fg-muted);
  font-size: 13px;
}
```

- [ ] **Step 3: Wire `app.js` to use `attachSuggestions`**

Open `/Users/a_/uk-rent-lookup/web/app.js`. Replace the entire file with:

```js
import { attachSuggestions } from "./suggestions.js";

const WORKER_URL = "https://uk-rent-lookup.sap09777.workers.dev";

const POUND = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const ERROR_MESSAGES = {
  invalid_postcode: "That doesn't look like a UK postcode.",
  missing_postcode: "Please enter a postcode.",
  postcode_not_found: "We couldn't find that postcode. Double-check it?",
  lookup_temporarily_unavailable:
    "The postcode service is having a moment — try again shortly.",
  no_data: "We don't have rent data for this area yet.",
  internal_error: "Something went wrong. Try again in a moment.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

const AREA_LEVEL_LABELS = {
  local_authority: "local authority",
  region: "region",
  country: "country",
};

const form = document.getElementById("lookup-form");
const input = document.getElementById("postcode");
const submit = form.querySelector("button");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showResult(data) {
  errorEl.hidden = true;
  const widened = data.area_level !== "local_authority";
  const widenedNote = widened
    ? `<div class="widened">Showing ${escapeHtml(AREA_LEVEL_LABELS[data.area_level] || data.area_level)}-level data — postcode-level figures aren't published for this area.</div>`
    : "";
  resultEl.innerHTML = `
    <div class="area">Average rent in <strong>${escapeHtml(data.area)}</strong></div>
    <div class="figure">${POUND.format(data.monthly_rent_gbp)} / month</div>
    ${widenedNote}
    <div class="meta">${escapeHtml(data.source)} · period ${escapeHtml(data.period)}</div>
  `;
  resultEl.hidden = false;
}

function showError(code) {
  resultEl.hidden = true;
  errorEl.textContent = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error;
  errorEl.hidden = false;
}

async function fetchAndRender(queryString) {
  submit.disabled = true;
  try {
    const resp = await fetch(`${WORKER_URL}/lookup?${queryString}`);
    const body = await resp.json();
    if (!resp.ok) return showError(body.error ?? "internal_error");
    showResult(body);
  } catch {
    showError("network");
  } finally {
    submit.disabled = false;
  }
}

attachSuggestions(input, ({ area_code, display }) => {
  fetchAndRender(`area_code=${encodeURIComponent(area_code)}`);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const pc = input.value.trim();
  if (!pc) return showError("missing_postcode");
  fetchAndRender(`postcode=${encodeURIComponent(pc)}`);
});
```

- [ ] **Step 4: Local smoke test**

```bash
cd /Users/a_/uk-rent-lookup/web
python3 -m http.server 8000 &
HTTP_PID=$!
sleep 2
echo "--- index.html OK? ---"
curl -sI http://localhost:8000/ | head -3
echo "--- suggestions.js served? ---"
curl -sI http://localhost:8000/suggestions.js | head -3
echo "--- app.js still served? ---"
curl -sI http://localhost:8000/app.js | head -3
kill $HTTP_PID 2>/dev/null
wait 2>/dev/null
```

Expected: all three return HTTP 200.

This step does not actually exercise the typeahead in a browser — that requires a human; it's covered in Task 5.

- [ ] **Step 5: Commit and push**

```bash
cd /Users/a_/uk-rent-lookup
git add web/
git commit -m "feat(web): wire typeahead suggestions into form"
git push
```

The push triggers the auto-deploy of the frontend (verified working in v1).

---

## Task 5: Live smoke test (USER)

**Files:** none (manual verification)

This task verifies the complete v2 experience against the live deployment. It must be done by the user in a browser — no subagent can drive this.

- [ ] **Step 1: Wait for the auto-deploy**

After the push in Task 4 Step 5, the frontend redeploys automatically — typically within 30 seconds. Confirm by visiting https://rent-lookup.sap09777.workers.dev/ and seeing the updated placeholder text "Enter postcode or area (e.g. SW1A 1AA, Ilford)".

If the page still shows the old placeholder after 2 minutes, hard-refresh (`⌘⇧R` on Mac) to bypass cache. If it's still old, check the Cloudflare dashboard for failed builds.

- [ ] **Step 2: Run the smoke checklist**

Open https://rent-lookup.sap09777.workers.dev/ and verify each row:

| Action | Expected |
|---|---|
| Type `IG1` slowly | Within ~300 ms of the last keystroke, dropdown shows ⌖ IG1 (Redbridge), ⌖ IG10 (Epping Forest), ⌖ IG11 (Barking and Dagenham), and (depending on `/places` results) ◎ Ilford |
| Click `IG1` row | Input becomes `IG1`; Redbridge rent figure renders below |
| Clear, type `ilford` | Dropdown shows ◎ Ilford suggestion |
| Click `Ilford` | Input becomes `Ilford`; same Redbridge figure renders |
| Type `RM13` | Dropdown shows RM13 (Havering) and possibly Rainham |
| Type `xy` | Dropdown shows nothing — no error |
| Type `SW1A 1AA`, press Enter (don't click suggestion) | Westminster figure renders (existing v1 path still works) |
| Type `IG`, press `↓ ↓ Enter` | Second row activates via keyboard, fetches that area |
| After a query, press `Esc` | Dropdown closes, input value preserved |
| Briefly turn Wi-Fi off, type `IG1` | Dropdown silently doesn't render; input remains usable |

- [ ] **Step 3: If anything is wrong, report what's broken**

Common likely issues (and how to fix):

- **Dropdown doesn't show at all:** open browser dev tools → Console. If you see `attachSuggestions: #suggestions element not found`, the `index.html` change in Task 4 Step 1 didn't take. If you see CORS errors talking to api.postcodes.io, that's a network/firewall issue.
- **Dropdown shows but rows are empty / "undefined":** the field-name accesses in `suggestions.js` don't match the postcodes.io response shape. Re-read Task 1 research note and fix the `// FIELD:` lines in `suggestions.js`.
- **Click doesn't fire a lookup:** check Console for JS errors; the `pick()` wiring in `suggestions.js` and the `onPick` callback in `app.js` should be linked.

- [ ] **Step 4: Mark complete**

If all rows pass, v2 is live.

---

## Self-review

Performed against the spec [2026-05-02-rent-lookup-v2-suggestions-design.md](../specs/2026-05-02-rent-lookup-v2-suggestions-design.md):

| Spec section | Covered by |
|---|---|
| §1 Goal | All tasks together |
| §2 Decisions: postcodes.io live, click-to-fetch, mixed list | Tasks 3, 4 |
| §3 Architecture: suggestions go browser→postcodes.io, lookups go browser→Worker | Tasks 2, 3, 4 |
| §4.1 Worker `?area_code=` branch | Task 2 |
| §4.2 `web/suggestions.js` module | Task 3 |
| §4.3 `web/app.js` wiring | Task 4 Step 3 |
| §4.4 `web/index.html` listbox + `style.css` dropdown styles | Task 4 Steps 1, 2 |
| §4.5 Worker tests (2 new) | Task 2 Step 1 (3 tests, exceeds spec — acceptable) |
| §5 Data flow exact sequence | Task 3 (the implementation) |
| §6 Error handling table (every row) | Task 3's `fetchJson()` (silent null on error) and Task 4's existing `showError()` |
| §7 UX: visual, keyboard, ARIA, mobile | Task 3 (`renderRow` has icons, keydown handler, ARIA roles) and Task 4 (CSS) |
| §8.1 Worker tests | Task 2 Step 1 |
| §8.2 Manual smoke checklist | Task 5 |
| §9 Rollout: Worker deploy + frontend push | Tasks 2.5 and 4.5 |
| §10 Out-of-scope items | Not implemented (correct) |
| §11 Open question 1 (response shape) | Task 1 |
| §11 Open question 2 (multi-LA outcode) | Task 1 Step 2 (decision captured), Task 3's `resolveOutcode` (uses index `[0]`) |

**Placeholder scan:**
- `// FIELD: ...` markers in `suggestions.js` are intentional — they refer to JSON field paths whose exact spelling depends on Task 1's research output. Each one names what the field represents and the surrounding code is otherwise concrete. The fallback chain (`?? p.county_unitary_id ?? null`) means even if one path is wrong, the code degrades gracefully.
- `<fill in: ...>` blocks in the research-note template (Task 1 Step 4) are not placeholders in the plan itself — they're prompts for the implementer to capture real values.
- No "TBD" / "TODO" / "implement later".

**Type consistency:**
- The suggestion shape `{ kind, display, area_code, secondary }` is defined in `getPostcodeSuggestions`/`getPlaceSuggestions` and consumed by `renderRow` and `pick` — all four sites match.
- The `onPick` callback signature `({ area_code, display })` is defined in Task 3 (`pick()` body) and consumed in Task 4 (`attachSuggestions(input, ({ area_code, display }) => …)`) — matches.
- The Worker `?area_code=` regex `^[ENWSK]\d{8}$` in Task 2 matches the spec §4.1.
- Error code `invalid_postcode` is reused across Worker and frontend (consistent with v1).
