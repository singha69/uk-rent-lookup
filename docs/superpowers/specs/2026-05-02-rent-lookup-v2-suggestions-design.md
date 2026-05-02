# UK Rent Lookup v2 — Live Suggestions & Area Search Design Spec

**Date:** 2026-05-02
**Status:** Draft, pending user review
**Author:** Brainstormed with Claude
**Builds on:** [v1 design spec](./2026-04-29-uk-rent-lookup-design.md)

---

## 1. Goal

Add live, debounced typeahead suggestions to the existing UK Rent Lookup site so users can:

- See suggestions as they type a partial postcode (`IG1` → `IG1`, `IG10`, `IG11`, plus the place name `Ilford`).
- Search by **area name** (typing `Ilford` finds Redbridge's rent without the user knowing the postcode).
- Click a suggestion to immediately render the rent for that area, no separate Search press.

The current flow (type a full postcode, press Search, see one result) remains untouched — v2 is purely additive.

## 2. Decisions made during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Data source for suggestions | **Live calls to postcodes.io** (`/postcodes/{prefix}/autocomplete` + `/places?q=…`) | Free, official, current. No new bundled data files to maintain. |
| Click suggestion behaviour | Fill input with display text **and immediately fetch rent** | Fewest clicks; matches user's "as I type" intent. |
| Visual treatment | **Mixed list with subtle icons** (`⌖` postcode, `◎` place), max 6 rows, postcodes ranked first | Single list keeps cognitive load low; icons disambiguate type. |
| Debounce | 200 ms | Standard typeahead default — responsive without hammering postcodes.io. |
| Min query length | 2 characters | Below 2 chars produces useless results and wastes API calls. |
| Failure mode for suggestion fetch | Silently hide the dropdown | Suggestions are additive; the input must still work when postcodes.io is down. |
| Frontend tests | None (manual smoke only) | Consistent with v1 scope; suggestion module is small, uses standard browser APIs. |

## 3. Architecture

### Request flow — typing

```
User types "ig1"
     │
     ▼ debounce 200 ms, min 2 chars, AbortController cancels in-flight calls
┌────────────────────┐
│ Frontend           │  GET https://api.postcodes.io/postcodes/IG1/autocomplete
│ (suggestions.js)   │  GET https://api.postcodes.io/places?q=ig1&limit=10
│ fires both in      │  (parallel, 2 s timeout each)
│ parallel           │
└─────────┬──────────┘
          │
          ▼ frontend post-processes
   • autocomplete → extract distinct outward codes; for each not in cache,
     GET /outcodes/{code} to get admin_district; cache result for the page lifetime
   • places → keep top N with their admin_district
          │
          ▼ merge into ranked list (postcodes first, then places, max 6 total)
┌────────────────────┐
│ Dropdown renders   │   ⌖  IG1   Redbridge        ← row carries data-area-code="E09000026"
│ ARIA listbox       │   ⌖  IG10  Epping Forest
│                    │   ⌖  IG11  Barking and Dagenham
│                    │   ◎  Ilford   London         ← also carries the resolved code
└─────────┬──────────┘
          │
          ▼ user clicks (or ↑/↓ + Enter)
┌────────────────────┐
│ Frontend           │   GET <worker>/lookup?area_code=E09000026
│ knows the code     │   (skip postcodes.io resolution path)
└─────────┬──────────┘
          │
          ▼ Worker reads RENTS table directly, returns JSON
   Result renders as before.
```

### Request flow — typing without picking a suggestion

Identical to v1: user types a full postcode, presses Search (or Enter), the form submit fires `<worker>/lookup?postcode=…` and the existing path runs unchanged.

### Why this shape

- **Additive, not replacement.** The suggestions module is a separate file; the existing form-submit path is preserved. If suggestions break for any reason, users fall back to the v1 experience seamlessly.
- **Suggestions never touch our Worker.** The browser talks directly to postcodes.io for typeahead. Our Worker is only hit when a rent is actually being fetched. This keeps the Worker quota and edge cache clean.
- **Backend change is minimal.** A single new query parameter on `/lookup` lets the frontend skip the postcode → area resolution when it already knows the code.

## 4. Components

### 4.1 Worker (`worker/src/index.ts`) — extension

Add a parallel branch:

- If `?area_code=` is present and matches `^[ENWSK]\d{8}$`, skip postcode validation/resolution and call `lookupRent(areaCode, RENTS, REGIONS)` directly.
- If `?postcode=` is present, behave exactly as today.
- If both are present, **`area_code` wins** (skips a network hop).
- If neither is present, return `400 missing_postcode`.
- If `area_code` is malformed, return `400 invalid_postcode`.

~15 added lines. No new error codes.

### 4.2 Frontend — `web/suggestions.js` (new module, ~80 lines)

Exports a single function `attachSuggestions(inputElement, onPick)`:

- Owns the debounced input listener (200 ms via `setTimeout` + `clearTimeout`).
- Owns an `AbortController` for cancelling stale in-flight fetches.
- Owns an in-memory `Map` cache: outward code → admin_district code (TTL = page lifetime).
- Calls postcodes.io's two endpoints in parallel, post-processes, renders the dropdown.
- Handles keyboard navigation (↑/↓ Enter Esc Tab) and ARIA roles.
- Calls `onPick({ area_code, display })` when a row is selected.

### 4.3 Frontend — `web/app.js` (modified)

- On page load: `attachSuggestions(input, handlePick)`.
- New `handlePick({ area_code, display })`:
  - Sets `input.value = display`.
  - Calls `fetch(<worker>/lookup?area_code=<code>)`.
  - Renders the result with the existing `showResult()` function.
- Existing form-submit path unchanged.

### 4.4 Frontend — `web/index.html` and `web/style.css`

- `index.html`: add a sibling `<ul role="listbox" id="suggestions" hidden>` element below the input. Add `aria-controls`/`aria-expanded` attributes on the input.
- `style.css`: dropdown container, row hover/highlight states, icon styling.

### 4.5 Tests

- `worker/test/index.test.ts`: two new vitest cases for the `?area_code=` path.
- No frontend tests (manual smoke).

## 5. Data flow — exact sequence

1. User keystroke fires `input` event.
2. The 200 ms debounce timer is reset.
3. After 200 ms of inactivity, the listener checks `value.length >= 2`.
4. Any in-flight request from a prior keystroke is aborted via the shared `AbortController`.
5. Two `fetch()` calls are issued in parallel:
   - `https://api.postcodes.io/postcodes/{ENCODED_VALUE}/autocomplete` (2 s timeout)
   - `https://api.postcodes.io/places?q={ENCODED_VALUE}&limit=10` (2 s timeout)
6. Both responses are parsed into a unified shape `{ kind: "postcode" | "place", display: string, area_code: string }`.
   - For postcode results, the response is a list of full postcodes — the module extracts unique outward codes (e.g. `IG1`, `IG10`, `IG11`) and resolves each to its `admin_district` via `/outcodes/{code}`, using the in-memory cache.
   - For place results, the `local_authority_district_id` (or equivalent admin field — verify exact key in the postcodes.io response shape during implementation) becomes `area_code`.
7. Results are merged: up to 3 postcodes, then up to 3 places. Limit total to 6.
8. Dropdown renders. If empty, dropdown is hidden.
9. On click or keyboard Enter on a row, `onPick({ area_code, display })` is called.
10. `app.js` sets the input value and fires `<worker>/lookup?area_code=<code>`.
11. Result renders below as in v1.

## 6. Error handling

| Failure | Behaviour |
|---|---|
| postcodes.io autocomplete API errors or times out | Suggestion list shows only places (if any). |
| postcodes.io places API errors or times out | Suggestion list shows only postcodes (if any). |
| Both error or time out | Dropdown silently hidden — no toast, no banner. |
| Empty results from both | Dropdown silently hidden. |
| User edits input after picking a suggestion | Cached pick is cleared; the next submit uses `?postcode=`. |
| Worker returns `no_data` for a picked area_code | Existing error message renders ("We don't have rent data for this area yet."). Falls back to country level via existing v1.5 logic. |
| Network offline mid-keystroke | `fetch` rejects; aborted by next keystroke's controller; dropdown stays in last-good state. |
| Rapid typing | Debounce + abort guarantees only the most recent query's results render. |

## 7. UX details

### Visual

Single list, max 6 rows, postcodes first then places. Each row:

```
[icon]  [primary text]   [secondary text]
  ⌖     IG1              Redbridge
  ◎     Ilford           London
```

Icons (`⌖` for postcode, `◎` for place) are subtle, ~14px, opacity 0.6. They tell the user the suggestion's type without shouting.

### Keyboard

| Key | Action |
|---|---|
| `↑` / `↓` | Highlight previous/next row (with wrap-around at top/bottom) |
| `Enter` | Activate the highlighted row (or first row if none highlighted) |
| `Esc` | Close the dropdown without picking |
| `Tab` | Leave the input; close the dropdown |
| Any character | Reset highlight, schedule new fetch |

### Accessibility

- The dropdown carries `role="listbox"`.
- Each row carries `role="option"` and a stable `id`.
- The input carries `aria-controls="suggestions"`, `aria-expanded="true|false"`, and `aria-activedescendant="<id of highlighted row>"`.
- Mouse and keyboard interactions are functionally identical.

### Mobile

The dropdown is absolutely positioned below the input. The on-screen keyboard pushes content up; the dropdown stays attached. No special mobile handling required.

## 8. Testing

### Automated (Worker only)

Two new vitest cases in `worker/test/index.test.ts`:

1. `GET /lookup?area_code=E09000033` → 200, body matches Westminster row.
2. `GET /lookup?area_code=NOT_A_CODE` → 400, body `{"error":"invalid_postcode"}`.

The 24 existing tests must still pass — the new branch is purely additive.

### Manual smoke (you, post-deploy)

| Action | Expected |
|---|---|
| Type `IG1` slowly | Within ~300 ms of last keystroke, dropdown shows ⌖ IG1, ⌖ IG10, ⌖ IG11, ◎ Ilford (or similar) |
| Click `IG1` row | Input becomes `IG1`; Redbridge rent renders below |
| Clear, type `ilford` | Dropdown shows ◎ Ilford |
| Click `Ilford` | Input becomes `Ilford`; same Redbridge rent renders |
| Type `RM13` | Dropdown shows RM13 + Rainham |
| Type `xy` | Dropdown shows nothing — no error |
| Type `SW1A 1AA`, press Enter (no click) | Westminster rent renders (existing v1 path) |
| Type `IG`, press `↓ ↓ Enter` | Second row activates via keyboard |
| Press `Esc` after a query | Dropdown closes |
| Briefly disable network, type `IG1` | Dropdown silently doesn't render; input remains usable |

## 9. Rollout

1. Implement Worker change → run tests → `npx wrangler deploy`.
2. Implement frontend modules → push to GitHub → auto-deploy picks up the change.
3. Run the manual smoke checklist above.
4. If all pass, v2 is live.

There is no flag, A/B, or gradual rollout — v2 is small enough to ship straight to all users.

## 10. Out of scope (deferred to v3 or later)

- "Recently searched" history (needs localStorage + privacy decision).
- Map view of the area.
- Property-type and bedroom-count breakdowns (same data-source constraint as v1).
- Server-side suggestion API (we don't need it; postcodes.io is free).
- Telemetry on which suggestions get clicked.

## 11. Open questions for execution time

1. Exact shape of the `/places` response — verify the `local_authority_district_id` (or equivalent admin_district field) key name during implementation. The plan task will start by hitting the live API and inspecting the response.
2. Whether postcodes.io's `/outcodes/{code}` returns a single admin_district or multiple (e.g. an outcode that spans two LAs). If multiple, we'll show the largest by population or the first listed.

## 12. Approval

Once the user has reviewed this document, the next step is to invoke the `superpowers:writing-plans` skill to break this design into an executable, phased implementation plan. The plan will be small — a handful of tasks — given how additive this iteration is.
