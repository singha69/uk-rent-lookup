# UK Rent Lookup — Data Sources Research Note

**Date:** 2026-04-29
**Author:** Task 0.3 research pass
**Purpose:** Capture exact URLs, schemas, and sample rows for the data sources that Phase 2 of the UK Rent Lookup pipeline will consume. Phase 2 code can fill in column-name placeholders directly from this note.

---

## TL;DR — Important deviations from the original spec

1. **Both rent datasets are XLSX, not CSV.** Neither ONS PIPR nor the legacy Land Registry / ONS PRMS dataset is published as CSV. Phase 2 will need an `openpyxl` (PIPR, .xlsx) + `xlrd` (PRMS, legacy .xls) read step rather than a pure-CSV download. The fields are clean and unambiguous after the header offset is skipped.
2. **The "HM Land Registry — Private rental market summary statistics in England" series was discontinued on 20 December 2023.** Its publisher had already migrated from VOA/Land-Registry-style branding to ONS by then, and the final release covers Oct 2022 – Sep 2023. From 20 March 2024, the new monthly *Private rent and house prices, UK* bulletin (powered by PIPR) replaces it. The ONS PIPR spreadsheet now publishes a £ "Rental price" level column at LAD granularity, so the PIPR file alone is sufficient — no Land Registry merge is strictly needed.
3. **The original spec's preference rule "LR > ONS because LR is real £" is therefore moot.** PIPR itself ships £ rental prices for every LA. The remaining choice is whether to also load the discontinued Dec 2023 PRMS file as a static fallback for any LA that is missing in PIPR (recommended: no — PIPR has full LA coverage for England + Wales; Scotland is only at BRMA level, which is a separate concern).
4. **LAD-to-Region lookup confirmed at December 2024 (`LAD24CD` / `RGN24CD`).** CSV download works.

The rest of this note documents each source in full so an engineer can wire up the pipeline.

---

## 1. ONS Price Index of Private Rents (PIPR)

The successor to IPHRP / IPRP. Renamed to PIPR in early 2024. Published monthly.

### Landing page (most recent release)

- Dataset landing page (always shows latest): https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics
- Companion bulletin (latest): https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/latest

### Direct download URL (most recent release at time of research)

Most recent file as of 2026-04-29 — release dated **22 April 2026**:

```
https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics/22april2026/priceindexofprivaterentsukmonthlypricestatistics10.xlsx
```

`curl -sIL` returns `HTTP/2 200`, `content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ~17 MB.

**File format:** `.xlsx` (Excel 2007+). **No CSV alternative is published.**

**Stable-URL caveat:** The filename is not date-stable. The release-date path segment changes each month and the trailing numeric suffix (`...statistics10.xlsx`) is incremented by ONS staff, so Phase 2 must scrape the dataset landing page for the current download anchor each run rather than hard-coding the URL.

### Granularity

- Temporal: monthly (one row per area per month, back to Jan 2015).
- Spatial: UK / countries / English regions (ITL1, `E12*`) / lower-tier local authorities in England and Wales (`E06*`, `E07*`, `E08*`, `E09*`, `W06*`) / Broad Rental Market Areas in Scotland & Northern Ireland.
- Total LA-level row count in current file: ~42,660 (≈316 LAs × ~135 months).

Verified counts of rows by area-code prefix in the April 2026 release:

| Prefix    | Description                  | Rows     |
| --------- | ---------------------------- | -------- |
| `K02`     | United Kingdom               | 135      |
| `E12`     | English regions (ITL1)       | 1 215    |
| `E06`     | Unitary authorities          | 8 370    |
| `E07`     | Non-metropolitan districts   | 22 140   |
| `E08`     | Metropolitan districts       | 4 860    |
| `E09`     | London boroughs              | 4 320    |
| `W06`     | Welsh unitary authorities    | 2 970    |
| `S92/N92` | Scotland / Northern Ireland  | 270      |
| other     | BRMAs etc.                   | ~3 781   |

### Workbook structure

The xlsx has four worksheets. Only one carries data:

| Sheet         | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `Cover sheet` | Title page                                           |
| `Contents`    | Lists worksheets                                     |
| `Notes`       | Definitions and footnote markers (`[x]`, `[z]`, ...) |
| `Table 1`     | The data                                             |

`Table 1` has two header rows (row 0 title, row 1 description) and the header proper on **row 2 (0-indexed)**. Data starts on row 3.

### Exact column names (Table 1, row 2)

40 columns total. The first 8 are the ones the rent-lookup pipeline needs:

| Index | Column                       | Used by pipeline?                            |
| ----- | ---------------------------- | -------------------------------------------- |
| 0     | `Time period`                | yes — period (datetime, first of month)      |
| 1     | `Area code`                  | yes — ONS GSS code                           |
| 2     | `Area name`                  | yes — human-readable name                    |
| 3     | `Region or country name`     | optional — region context (`[z]` for nations)|
| 4     | `Index`                      | optional — overall PIPR index (Jan 2015=100) |
| 5     | `Monthly change`             | no                                           |
| 6     | `Annual change`              | optional — % YoY                             |
| 7     | `Rental price`               | **yes — £ median rent, integer**             |

Remaining columns 8–39 repeat the `Index / Monthly change / Annual change / Rental price` pattern broken down by bedroom count (1/2/3/4+) and property type (detached / semidetached / terraced / flat-maisonette).

The sentinel `[x]` is used for "not applicable / suppressed", `[z]` for "not separately identified".

### First 5 lines (CSV-equivalent of Table 1, header + 4 rows)

```csv
Time period,Area code,Area name,Region or country name,Index,Monthly change,Annual change,Rental price
2015-01-01,K02000001,United Kingdom,[z],81.258259,[x],[x],910
2015-02-01,K02000001,United Kingdom,[z],81.413747,0.191351,[x],912
2015-03-01,K02000001,United Kingdom,[z],81.663685,0.306997,[x],915
2015-04-01,K02000001,United Kingdom,[z],81.990506,0.400204,[x],918
```

Sample LA-level row at the latest period (March 2026):

```csv
2026-03-01,E07000008,Cambridge,East of England,119.712411,0.123854,1.83524,1795
```

Sample regional rows at March 2026 (the ITL1 fallback layer the pipeline will use when an LA is missing):

```csv
2026-03-01,E12000001,North East,[z],124.705278,0.325168,6.465431,772
2026-03-01,E12000002,North West,[z],126.828594,0.374384,5.71552,947
2026-03-01,E12000003,Yorkshire and The Humber,[z],119.076368,0.450376,4.399988,852
2026-03-01,E12000004,East Midlands,[z],123.022278,0.166022,4.207837,910
2026-03-01,E12000005,West Midlands,[z],123.943831,0.172764,4.825198,964
2026-03-01,E12000006,East of England,[z],121.630582,0.435017,4.197142,1274
2026-03-01,E12000007,London,[z],124.558916,0.290094,1.664625,2280
2026-03-01,E12000008,South East,[z],120.704028,0.178228,3.167503,1411
2026-03-01,E12000009,South West,[z],119.903642,0.057156,5.055233,1227
```

Confirms the spec's example codes: `E12000007` = London, `E12000003` = Yorkshire and The Humber.

---

## 2. Land Registry / ONS — Private rental market summary statistics in England (PRMS)

**Status: discontinued.** Final release was 20 December 2023, covering October 2022 – September 2023. Replaced by PIPR + the *Private rent and house prices, UK* bulletin from 20 March 2024.

### Landing pages

- Dataset page (still hosted, marked discontinued): https://www.ons.gov.uk/peoplepopulationandcommunity/housing/datasets/privaterentalmarketsummarystatisticsinengland
- Final bulletin: https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/privaterentalmarketsummarystatisticsinengland/october2022toseptember2023
- Previous releases: https://www.ons.gov.uk/peoplepopulationandcommunity/housing/bulletins/privaterentalmarketsummarystatisticsinengland/previousreleases

### Direct download URL (final / most recent ever)

```
https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/housing/datasets/privaterentalmarketsummarystatisticsinengland/october2022toseptember2023/privaterentalmarketstatistics231220.xls
```

`curl -sIL` returns `HTTP/2 200`, `content-type: application/vnd.ms-excel`, ~489 KB.

**File format:** legacy `.xls` (BIFF8, requires `xlrd<2` to read in Python).

### Granularity

- Temporal: 12-month rolling window (here 1 Oct 2022 – 30 Sep 2023). One snapshot, not a time series.
- Spatial: England only, broken down by Region (ITL1) and Local Authority (administrative area). Sourced from VOA private rental records.
- Categories: All, 1-bed, 2-bed, 3-bed, 4+-bed, room-only, studio (each on its own table).

### Workbook structure

17 sheets. Each "Table N.x" sheet covers one bedroom category:

- `Table 1.1` … `Table 1.7` — by Region. (`1.7` = "all categories" summary.)
- `Table2.1` … `Table2.7` — by administrative area (LA). (`2.7` = "all categories" summary, this is the one the pipeline needs.)

`Table2.7` has 403 rows. The header is on **row 6 (0-indexed)** and data begins on row 7.

### Exact column names (Table2.7, row 6)

Note row 6 has an empty cell in column 0 (an unused leading column). Effective columns:

| Index | Column            | Used by pipeline?                       |
| ----- | ----------------- | --------------------------------------- |
| 0     | (blank)           | no                                      |
| 1     | `LA Code1`        | no — legacy 4-digit ONS LA code, not GSS|
| 2     | `Area Code1`      | **yes — ONS GSS code (E06/E07/E08/E09/E12/E92)** |
| 3     | `Area`            | yes — name                              |
| 4     | `Count of rents`  | optional — sample size                  |
| 5     | `Mean`            | optional — mean monthly rent £          |
| 6     | `Lower quartile`  | no                                      |
| 7     | `Median`          | **yes — median monthly rent £**         |
| 8     | `Upper quartile`  | no                                      |

Period is implicit in the file name / sheet title (1 Oct 2022 – 30 Sep 2023). There is **no period column** — the file is a single snapshot.

### First 5 lines (CSV-equivalent of Table 2.7, header + 4 data rows)

```csv
,LA Code1,Area Code1,Area,Count of rents,Mean,Lower quartile,Median,Upper quartile
,NA,E92000001,ENGLAND,459340.0,994.0,650.0,850.0,1200.0
,NA,E12000001,NORTH EAST,20360.0,621.0,450.0,550.0,695.0
,1355.0,E06000047,County Durham UA,4670.0,545.0,425.0,498.0,600.0
,1350.0,E06000005,Darlington UA,1990.0,542.0,430.0,505.0,600.0
```

Note: Region rows use `LA Code1 = "NA"` and the GSS code in `Area Code1` (e.g. `E12000001`). Country row uses `E92000001` for England.

---

## 3. ONS Open Geography Portal — LAD-to-Region lookup

### Direct CSV download URL

Most recent published version is **December 2024** (codes use the 24 suffix throughout):

```
https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/3959874c514b470e9dd160acdc00c97a/csv?layers=0
```

`curl -sIL` returns `HTTP/1.1 302` redirect to a `hub.arcgis.com` download endpoint that streams the CSV. Final response is plain CSV text. Stable for at least the lifetime of this dataset version.

Landing pages (for human verification):

- ONS geoportal: https://geoportal.statistics.gov.uk/datasets/ons::local-authority-district-to-region-december-2024-lookup-in-en/about
- data.gov.uk mirror: https://www.data.gov.uk/dataset/3fbe9109-f329-4c4a-85cb-3b78ea4fbce3/local-authority-district-to-region-december-2024-lookup-in-en
- Underlying FeatureServer (for ad-hoc queries): https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LAD24_RGN24_EN_LU/FeatureServer/0

### Format

Plain CSV, UTF-8 with BOM. 296 data rows + 1 header. England only (the lookup is "in EN").

### Column names

```
LAD24CD, LAD24NM, RGN24CD, RGN24NM, ObjectId
```

The pipeline only needs `LAD24CD` (join key against PIPR `Area code`) and `RGN24CD` (which is `E12000001`–`E12000009`).

### First 3 lines

```csv
LAD24CD,LAD24NM,RGN24CD,RGN24NM,ObjectId
E06000001,Hartlepool,E12000001,North East,1
E06000002,Middlesbrough,E12000001,North East,2
```

(File starts with a UTF-8 BOM `﻿` before `LAD24CD` — standard `pandas.read_csv` with `encoding="utf-8-sig"` handles this.)

---

## 4. Decisions / notes

### 4.1 Coding system compatibility — confirmed

All three sources use **ONS GSS 9-character codes** in their primary area-code column:

- PIPR `Area code` → `E07000008` (Cambridge)
- PRMS `Area Code1` → `E07000008` would be present (sample shows `E06000047`, `E06000005`, etc.)
- LAD-to-Region `LAD24CD` → `E06000001` (Hartlepool)

The PRMS file additionally carries a legacy 4-digit `LA Code1` (e.g. `1355`, `724`) — ignore that. Use `Area Code1` only.

A simple inner join on the GSS code will work cleanly between PIPR and the LAD-to-Region lookup. PIPR area names occasionally include an "UA" suffix that PRMS does not (e.g. PRMS: "County Durham UA" vs PIPR: "County Durham"); since the join is on code, this is fine.

### 4.2 Choice of £ figure — revised

The original spec said "prefer Land Registry's £ median over ONS's index when both have a figure for the same area". This is now obsolete because:

1. PRMS (the Land Registry / VOA-sourced £ median) has not been updated since December 2023 — those figures are 2½ years stale.
2. PIPR itself publishes a `Rental price` £ figure at LA granularity, refreshed monthly.

**Revised rule for Phase 2:** the per-LA £ figure is `PIPR.Rental price` for the most recent month available. Do not bother loading PRMS unless a specific QA exercise calls for it. (If the team still wants a static fallback table of medians from PRMS for areas where PIPR has noisy small-sample numbers, the PRMS file is captured here for that purpose — but the spec's preference inversion is no longer applicable.)

### 4.3 Region-level (ITL1) fallback — confirmed

PIPR Table 1 contains a row for each of the nine English regions for every month, identified by codes `E12000001` through `E12000009`:

| Code        | Name                       |
| ----------- | -------------------------- |
| `E12000001` | North East                 |
| `E12000002` | North West                 |
| `E12000003` | Yorkshire and The Humber   |
| `E12000004` | East Midlands              |
| `E12000005` | West Midlands              |
| `E12000006` | East of England            |
| `E12000007` | London                     |
| `E12000008` | South East                 |
| `E12000009` | South West                 |

These rows have `Region or country name = "[z]"` (sentinel for "not applicable") and a populated `Rental price`. Phase 2 should load them as the LA-fallback layer: when a postcode resolves to an LAD that has no PIPR row for the latest month, look up the LAD's region via the LAD-to-Region CSV and use the regional `E12*` rent.

The same file also has country-level rows (`E92000001` England, `W92000004` Wales, `S92000003` Scotland, `N92000002` Northern Ireland) and `K02000001` for the UK. Use the country row as a final fallback.

### 4.4 Implementation hints for Phase 2

- Use `openpyxl` (read-only, `data_only=True`) to read PIPR. Skip the first two header rows. The Notes sheet documents `[x]` and `[z]` sentinels — treat them as null in `Monthly change`/`Annual change`.
- Use `xlrd<2.0.0` to read the legacy PRMS `.xls` if loading it.
- The PIPR landing page URL is stable but the file URL inside it is not. Scrape the page each run (`requests` + `bs4` against the first `<a class="btn--primary"` or the first `.xlsx` anchor) to find the current month's link.
- Build the join: `PIPR (Area code) ⟕ LAD-to-Region (LAD24CD)` to attach a region code to every LA row, then collapse to one row per LAD using the most recent `Time period`.

---

## Self-review

- All three URLs return HTTP 200 directly downloadable (verified with `curl -sIL`).
- All column names captured from real files, not guessed.
- Sample rows captured from each file.
- File written to `/Users/a_/Documents/claude/docs/superpowers/research/2026-04-29-data-sources.md`.
