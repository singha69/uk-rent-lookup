# UK Rent Lookup — v1 Design Spec

**Date:** 2026-04-29
**Status:** Draft, pending user review
**Author:** Brainstormed with Claude

---

## 1. Goal

Build a public web application that lets a UK visitor enter a postcode and see the **average monthly rent** for their area, sourced from official UK datasets, with the figure's freshness shown on every result.

The site must be free to operate, runnable by a first-time coder, and architected so that paid third-party data sources can be slotted in later without a rewrite.

## 2. Refined problem statement

> Build a public web application that lets a UK visitor enter a postcode (full or outward-only, e.g. `SW1A 1AA` or `SW1A`) and see the **average monthly rent** for that area. "Average" is the most recent figure published by an official UK source.
>
> **Data:** "Real-time" is redefined to mean "auto-refreshes from the latest official release" — no scraping. Show the data's last-updated timestamp on every result.
>
> **Audience & scale:** Free, anonymous public site. Initially expect ~100 visits/day, designed to scale to ~10k/day without redesign.
>
> **Reliability:** Target ~99% monthly uptime (hobby tier). Cached results must remain available even if the upstream data sources are down.
>
> **Operator:** First-time coder. Must be deployable, monitorable, and recoverable by a single non-expert operator. Prefer managed/serverless services with generous free tiers.
>
> **Out of scope (v1):** User accounts, alerts, historical charts, sale prices, mortgage calculators, payments, property-type and bedroom breakdowns, comparisons, trend lines.

## 3. Decisions made during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Data source(s) | **ONS Price Index of Private Rents (PIPR)** as the sole source for v1. (Originally also planned to use HM Land Registry's PRMS, but research on 2026-04-29 confirmed PRMS was discontinued in Dec 2023 and PIPR now publishes its own £ `Rental price` column at LA granularity monthly.) | Both free and official. PIPR alone gives full LA-level coverage for England + Wales plus regional fallback in one file. |
| Behaviour when postcode-level data is unavailable | **Auto-widen** to the smallest containing area (e.g. local authority → region) with a label noting the scope shift | Always returns useful data; users understand why. |
| Reliability tier | **Hobby-grade free hosting**, accepting cold starts and ~99% uptime | Aligns with £0/month budget and v1 audience size. |
| v1 feature scope | Postcode in → one average rent figure + last-updated date. Nothing else. | Smallest viable; everything else moved to v2 backlog. |
| Working mode | "Mix mode" — explain big pieces but not every line | Operator wants to understand the architecture, not learn syntax. |
| Stack | **Cloudflare Pages + Cloudflare Worker + GitHub Actions** | Fewest moving parts, near-zero cold starts at edge, £0/month, easy operator workflow. |
| Result-page layout | **Search-engine style** — centered title, postcode input, result rendered as a coloured callout strip below | User selection from visual mockups. |

## 4. Architecture

```
┌──────────────────────────────┐
│  User's browser              │
│  (static HTML + a little JS) │
└──────────────┬───────────────┘
               │ GET /lookup?postcode=SW1A1AA
               ▼
┌──────────────────────────────┐
│  Cloudflare Worker           │
│  (the "lookup" service)      │
└──────────────┬───────────────┘
               │ reads bundled JSON
               ▼
┌──────────────────────────────┐
│  rents.json (lookup table)   │
│  shipped with the Worker     │
└──────────────────────────────┘
               ▲
               │ rebuilt monthly by:
               │
┌──────────────────────────────┐
│  GitHub Actions cron (1st of │
│  every month)                │
│  Downloads ONS + Land Reg    │
│  → joins → commits PR        │
└──────────────────────────────┘
```

**Three independent units:**

1. **Frontend** — a static page (HTML + tiny JS) that submits the postcode and renders the response.
2. **Worker** — a single function: `postcode → { area, average_rent, source, updated_at }`. Reads from a pre-built table; no third-party calls at request time other than postcode resolution.
3. **Data pipeline** — a scheduled GitHub Action that rebuilds the lookup table once a month from official sources.

**Why this shape:**
- The frontend has zero dependencies — even with the Worker down, the page loads.
- The Worker performs no data crunching at request time and reads rent figures from a JSON file shipped in the deploy artifact, so the rent dataset itself is never an upstream dependency. The only request-time external call is to `postcodes.io` for postcode → area resolution; failure of that call is handled explicitly (Section 7) and never reaches the rent dataset.
- Data refresh is decoupled from request serving. A failed refresh leaves last month's data in place — the site never goes down because of a refresh failure.

## 5. Components

### 5.1 Frontend (`web/`)
- **Stack:** plain HTML + CSS + a single small JavaScript file. No framework.
- **Files:**
  - `index.html` — search-engine-style layout: centered title, postcode input, callout-strip result area.
  - `style.css` — minimal styling.
  - `app.js` — handles form submit, calls the Worker, renders the result, handles errors.
- **Hosted on:** Cloudflare Pages (git-connected, free tier).

### 5.2 Worker (`worker/`)
- **Stack:** TypeScript, single Cloudflare Worker, ~100 lines.
- **Endpoint:** `GET /lookup?postcode=<x>`
- **Pipeline at request time:**
  1. Validate and normalize the postcode (uppercase, strip spaces).
  2. Resolve postcode → local-authority code via `postcodes.io` (response cached 24h at edge).
  3. Look up that authority code in the bundled `rents.json`.
  4. If not found, walk up to the parent region and retry (auto-widen).
  5. Return JSON: `{ area, area_level, average_rent_gbp, currency, period, source, updated_at }`.
- **Edge caching:** responses cached at Cloudflare's edge for 1 hour.

### 5.3 Data pipeline (`data/`)
- **Stack:** Python 3.11+, single `pipeline.py` orchestrator (~150 lines), plus per-source modules.
- **Inputs:**
  - **ONS Private Rent Index** — official monthly CSV download.
  - **HM Land Registry rentals data** — official quarterly dataset.
- **Per-source modules:** `data/sources/ons.py`, `data/sources/land_registry.py`. Each exposes a uniform interface (`fetch() → list[AreaRent]`). To add a paid postcode-level provider later, add a new module — no orchestrator changes required.
- **Output:** `worker/data/rents.json`, keyed by local-authority code with regional aggregates.
- **Triggering:** GitHub Actions cron, 1st of each month at 03:00 UTC. Opens a PR with the regenerated file. PR auto-merges if checks pass.

### 5.4 Repository layout
```
uk-rent-lookup/
├── web/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── worker/
│   ├── src/index.ts
│   ├── data/rents.json        # generated, committed
│   ├── test/
│   └── wrangler.toml
├── data/
│   ├── pipeline.py
│   ├── sources/
│   │   ├── ons.py
│   │   └── land_registry.py
│   ├── test/
│   └── requirements.txt
├── .github/workflows/
│   └── refresh-data.yml       # monthly cron
└── README.md
```

## 6. Data flow

### 6.1 Request path

1. **Browser:** `app.js` takes the user's postcode input and calls `fetch('/lookup?postcode=SW1A1AA')`.
2. **Cloudflare edge:** consults its cache for the postcode key. Cache hit returns immediately (no Worker invocation). Cache miss forwards to the Worker.
3. **Worker:**
   - Normalize input (uppercase, remove whitespace).
   - Validate against UK postcode regex. Failure → `400 { error: "invalid_postcode" }`.
   - Call `postcodes.io` to resolve to a local-authority code.
     - 200 → extract `codes.admin_district`.
     - 404 → `{ error: "postcode_not_found" }`.
     - 5xx or timeout → `{ error: "lookup_temporarily_unavailable" }`.
   - Read `rents.json[areaCode]`. If missing, retry at the parent region code (auto-widen). If still missing, `{ error: "no_data" }`.
   - Return result JSON with `area_level` indicating whether the figure is local-authority or wider.
4. **Browser:** renders the callout strip with the figure, area name, source, and date. On any error code, renders the corresponding friendly message.

### 6.2 Refresh path

1. GitHub Actions cron fires on the 1st of the month at 03:00 UTC.
2. `pipeline.py` runs each source module, joins on area code, takes the most recent figure per area, and writes `worker/data/rents.json`.
3. The action commits the change and opens a PR titled `data: refresh YYYY-MM`.
4. CI runs the pipeline tests and Worker tests; on green, the PR auto-merges.
5. Cloudflare picks up the merge and redeploys the Worker. The new data is live within a minute.

## 7. Error handling

| Failure | Where caught | User experience |
|---|---|---|
| Postcode malformed (e.g. `XYZ`) | Worker validation, before any network call | Inline message: *"That doesn't look like a UK postcode."* |
| Postcode well-formed but doesn't exist | `postcodes.io` 404 | *"We couldn't find that postcode. Double-check it?"* |
| `postcodes.io` slow (>3s) or down | Worker timeout / try-catch | *"Postcode service is having a moment — try again shortly."* (HTTP 503) |
| Postcode valid, local authority not in table | Auto-widen to parent region | Result shown with a *"showing data for South East England"* note. |
| Local authority and region both missing | After auto-widen exhausts | *"We don't have rent data for this area yet."* |
| Worker exception (bug, OOM, etc.) | Cloudflare default 500 handler | *"Something went wrong. Try again in a moment."* |
| Cloudflare itself unavailable | Out of scope | Site unreachable. Cloudflare's own SLA is acceptable for this tier. |
| Monthly data refresh fails | GitHub Actions email notification | No user-visible impact — last month's `rents.json` keeps serving. |
| Edge cache holds bad result | 1-hour TTL | Self-healing within an hour. |

### Resilience principles

1. **Last-known-good always wins.** A failed refresh never causes a user-facing outage; old data continues to serve.
2. **Validate before calling out.** Cheap checks (regex) precede expensive ones (network), saving latency and quota.
3. **Errors are typed, not strings.** The Worker returns `{ error: "<code>" }`; the frontend owns user-facing wording. This keeps the API stable as copy evolves.

### Explicitly out of scope for v1

- Sentry / external error tracking — Cloudflare's built-in dashboard is sufficient at this scale.
- Automatic retries — silent retries hide problems and burn free-tier quota; users can retry by clicking again.
- Rate limiting — Cloudflare's free tier already absorbs abuse.

## 8. Testing

### 8.1 Worker unit tests (`worker/test/`)

Run by `npm test`. Network calls (`postcodes.io`, the rents table) are mocked.

| Test | Verifies |
|---|---|
| Valid postcode returns expected area + figure | Happy path |
| Lowercase / spaces / mixed case all normalize identically | Input cleaning |
| Malformed postcode returns `invalid_postcode` | Validation |
| Unknown postcode returns `postcode_not_found` | 404 handling |
| Missing local authority auto-widens to region | Fallback logic |
| Both missing returns `no_data` | Edge case |
| `postcodes.io` 5xx returns `lookup_temporarily_unavailable` | Upstream failure |

### 8.2 Data pipeline tests (`data/test/`)

Tests that the joiner produces a sane `rents.json` from fixed sample inputs. Primary purpose: catch breakage when ONS or Land Registry change their column names or area-code formats.

### 8.3 Manual smoke test (pre-deploy)

A four-postcode checklist (London, rural England, Scotland, deliberately invalid). ~30 seconds. End-to-end browser tests are out of scope for v1.

## 9. Operations

### Cadence

- **Daily:** nothing.
- **Monthly (~5 min):** review and merge the data-refresh PR. If CI failed, debug `ons.py` / `land_registry.py` (most common cause: upstream column rename).
- **Quarterly (~15 min):** renew Cloudflare API tokens if asked, run `npm audit`, bump dependencies, redeploy.

### Monitoring (v1)

| Signal | Where | Meaning |
|---|---|---|
| GitHub Actions failure | GitHub email | Refresh broken. Site still works. Fix when convenient. |
| Cloudflare error rate >1% | Cloudflare dashboard, weekly glance | Worker throwing — investigate. |
| Cloudflare request count spike | Same dashboard | Either growth or scraping. |

### Future "go pro" path (out of scope for v1, but architecture supports it)

- Cloudflare Workers Paid ($5/mo) — eliminates cold starts and quota worry.
- UptimeRobot free tier hitting `/lookup?postcode=SW1A1AA` every 5 min.
- Sentry free tier on the Worker for stack traces.

Each is a one-evening change.

### Operator's "shopping list"

| Thing | Cost | Purpose |
|---|---|---|
| GitHub account | Free | Code hosting + monthly cron |
| Cloudflare account | Free | Static site + Worker hosting |
| Node.js 20+ locally | Free | Worker dev/test |
| Python 3.11+ locally | Free | Pipeline dev/test |
| Wrangler CLI | Free | Worker deployment |
| Custom domain | Optional, ~£10/yr | Cloudflare provides a free `*.pages.dev` subdomain |

**Total v1 cost: £0** (~£10/year if a custom domain is purchased).

## 10. v2 backlog (explicitly deferred)

For reference; not in scope.

- Property-type and bedroom-count breakdowns (requires richer data source).
- 12-month trend line.
- Two-postcode comparison view.
- Email or SMS price alerts.
- Map-based area display.
- Paid postcode-level data provider integration (the data-source abstraction is designed for this).
- Mobile native apps.
- User accounts, history, saved searches.

## 11. Open questions for execution time

These don't block design approval but will need to be answered when the implementation plan is written:

1. Exact ONS dataset URL and column schema as of the build date — to be confirmed by the data-pipeline researcher before coding.
2. Exact HM Land Registry rentals dataset URL and schema — same.
3. Mapping table from ONS area codes to LAD codes (likely a single static lookup, but exact source needs confirming).
4. Custom domain decision — defer to deploy time.

## 12. Approval

Once the user has reviewed this document, the next step is to invoke the `superpowers:writing-plans` skill to break this design into an executable, phased implementation plan.
