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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pc = input.value.trim();
  if (!pc) return showError("missing_postcode");
  submit.disabled = true;
  try {
    const resp = await fetch(`${WORKER_URL}/lookup?postcode=${encodeURIComponent(pc)}`);
    const body = await resp.json();
    if (!resp.ok) return showError(body.error ?? "internal_error");
    showResult(body);
  } catch {
    showError("network");
  } finally {
    submit.disabled = false;
  }
});
