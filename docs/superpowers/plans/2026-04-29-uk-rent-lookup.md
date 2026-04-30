# UK Rent Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a free public site at a Cloudflare-hosted URL that, given a UK postcode, returns the most recent average monthly rent for the user's area, sourced from the ONS Price Index of Private Rents (PIPR) and refreshed automatically on the 1st of every month by a GitHub Actions cron.

> **Plan revision (2026-04-29 after Task 0.3 research):** The original plan called for joining ONS PIPR with HM Land Registry's PRMS dataset. Research found PRMS was discontinued on 20 Dec 2023 and PIPR now publishes a `Rental price` £ column at local-authority granularity monthly. **Task 2.4 (Land Registry source module) is dropped.** Task 2.3 (ONS source) is reworked for `.xlsx` reading + landing-page scraping (PIPR file URL is not date-stable). Task 2.5 (joiner) is simplified to a single-source pass-through. See `docs/superpowers/research/2026-04-29-data-sources.md` for the full evidence.

**Architecture:** Three decoupled units — a static HTML/CSS/JS frontend on Cloudflare Pages, a TypeScript Cloudflare Worker exposing `GET /lookup`, and a Python data pipeline that pre-builds a JSON lookup table committed to the repo. The Worker reads the bundled JSON; refresh failures cannot break serving.

**Tech Stack:** TypeScript + Cloudflare Workers (`wrangler`), plain HTML/CSS/JS + Cloudflare Pages, Python 3.11 + `pandas` + `requests`, GitHub Actions cron, `vitest` for Worker tests, `pytest` for pipeline tests.

**Spec:** [docs/superpowers/specs/2026-04-29-uk-rent-lookup-design.md](../specs/2026-04-29-uk-rent-lookup-design.md)

---

## Phase 0 — Tools and accounts (one-time, ~30 minutes)

### Task 0.1: Install local toolchain

**Files:** none (installs only)

- [ ] **Step 1: Install Homebrew** (if not already installed)

Run: `which brew`
If empty, run: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

- [ ] **Step 2: Install Node.js 20+, Python 3.11+, and `gh` CLI**

Run: `brew install node python@3.11 gh`

- [ ] **Step 3: Verify versions**

Run: `node --version && python3.11 --version && gh --version`
Expected: node ≥ v20, python ≥ 3.11, gh ≥ 2.x

- [ ] **Step 4: Install Wrangler globally**

Run: `npm install -g wrangler`

Run: `wrangler --version`
Expected: a version string (e.g. `⛅️ wrangler 3.x.x`).

### Task 0.2: Create GitHub and Cloudflare accounts

**Files:** none (account creation)

- [ ] **Step 1: GitHub account**

Visit https://github.com/signup if you don't already have an account. Stop here if you do.

- [ ] **Step 2: Authenticate `gh` CLI**

Run: `gh auth login`
Choose: GitHub.com → HTTPS → Yes (authenticate Git) → Login with web browser → copy code → paste in browser.

Run: `gh auth status`
Expected: "Logged in to github.com as <username>"

- [ ] **Step 3: Cloudflare account**

Visit https://dash.cloudflare.com/sign-up. Verify your email.

- [ ] **Step 4: Authenticate Wrangler**

Run: `wrangler login`
A browser opens; click Allow.

Run: `wrangler whoami`
Expected: your Cloudflare email.

### Task 0.3: Research the data source URLs and schemas

**Files:**
- Create: `docs/superpowers/research/2026-04-29-data-sources.md`

This task confirms the exact URLs and column names of the two datasets. Without it, the pipeline code in Phase 2 cannot be made concrete.

- [ ] **Step 1: Find the ONS Private Rent Index dataset**

Open https://www.ons.gov.uk in a browser and search "Price Index of Private Rents" (PIPR) — this is the successor to the old "Index of Private Housing Rental Prices". Find the most recent release page.

Capture:
- The page URL.
- The CSV download URL for the dataset broken down by **local authority** (also called "lower-tier local authority" / LAD).
- A copy of the first 5 lines of the CSV (use `curl -s <url> | head -5`).

- [ ] **Step 2: Find the HM Land Registry rentals dataset**

Open https://www.gov.uk/government/collections/private-rental-market-summary-statistics-in-england and find the most recent release. Note this is England-only; if Scotland/Wales/NI coverage is needed later, separate sources apply (out of scope for v1).

Capture: page URL, CSV download URL, first 5 lines.

- [ ] **Step 3: Write the research note**

Create the file with this content (filled in with your findings):

```markdown
# Data sources research — 2026-04-29

## ONS Private Rent Index (PIPR)
- Page: <url>
- CSV: <url>
- Granularity: <e.g. local authority, monthly>
- Key columns:
  - `<column name>`: area code (format: <e.g. E09000033>)
  - `<column name>`: area name
  - `<column name>`: index value or £/month figure
  - `<column name>`: period (format: <e.g. 2026M03>)
- First 5 lines:

\`\`\`
<paste here>
\`\`\`

## HM Land Registry rentals
- Page: <url>
- CSV: <url>
- Granularity: <e.g. local authority, quarterly>
- Key columns:
  - `<column name>`: area code
  - `<column name>`: area name
  - `<column name>`: median monthly rent £
  - `<column name>`: period
- First 5 lines:

\`\`\`
<paste here>
\`\`\`

## Area code mapping
- ONS uses ONS codes (e.g. E09000033 = Westminster).
- Land Registry uses LAD codes — need to verify they match ONS codes.
- If mismatched, lookup table source: <ONS Open Geography Portal URL>.

## Decisions
- "Average rent" for v1 = <chose ONS or LR; recommended: prefer LR median if available, else ONS index combined with anchor>.
- Region fallback structure: ONS publishes region-level (ITL1) figures with codes E12*. Use these for auto-widen.
```

- [ ] **Step 4: Commit the research note**

This will be committed as part of the first repo commit in Task 1.1; for now save it in this directory.

---

## Phase 1 — Repository scaffolding

### Task 1.1: Create the repository

**Files:**
- Create: `uk-rent-lookup/.gitignore`
- Create: `uk-rent-lookup/README.md`
- Create: `uk-rent-lookup/LICENSE`

- [ ] **Step 1: Make the project directory and initialize git**

Run from your home directory:
```bash
mkdir -p ~/uk-rent-lookup
cd ~/uk-rent-lookup
git init -b main
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# Node
node_modules/
.wrangler/
.dev.vars

# Python
__pycache__/
*.pyc
.venv/
venv/
.pytest_cache/

# OS
.DS_Store

# Editor
.idea/
.vscode/

# Build/test artifacts
coverage/
dist/
```

- [ ] **Step 3: Create `README.md`** (this is a placeholder — Task 6.2 fills it in)

```markdown
# UK Rent Lookup

A free site that returns the average monthly rent for a UK postcode, sourced from official UK datasets.

See [the design spec](docs/superpowers/specs/2026-04-29-uk-rent-lookup-design.md) for what this is and how it works.
```

- [ ] **Step 4: Create `LICENSE`**

Create `LICENSE` with the contents of the MIT License (substitute current year and your name):

```
MIT License

Copyright (c) 2026 <Your Name>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: First commit**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/research
# Copy the spec and research note into place
cp ~/Documents/claude/docs/superpowers/specs/2026-04-29-uk-rent-lookup-design.md docs/superpowers/specs/
cp ~/Documents/claude/docs/superpowers/research/2026-04-29-data-sources.md docs/superpowers/research/
git add .
git commit -m "chore: initialize repo with spec and research"
```

### Task 1.2: Create the GitHub remote

**Files:** none (creates the remote)

- [ ] **Step 1: Create the repo on GitHub and push**

```bash
gh repo create uk-rent-lookup --public --source=. --remote=origin --push
```

- [ ] **Step 2: Verify**

Run: `gh repo view --web`
A browser opens to your repo. Confirm the spec and README are visible.

---

## Phase 2 — Data pipeline

### Task 2.1: Set up the Python project

**Files:**
- Create: `data/requirements.txt`
- Create: `data/requirements-dev.txt`
- Create: `data/pyproject.toml`

- [ ] **Step 1: Create `data/requirements.txt`**

```
requests==2.32.3
pandas==2.2.3
openpyxl==3.1.5
beautifulsoup4==4.12.3
```

- [ ] **Step 2: Create `data/requirements-dev.txt`**

```
-r requirements.txt
pytest==8.3.4
responses==0.25.7
```

- [ ] **Step 3: Create `data/pyproject.toml`** (lets pytest discover the package)

```toml
[tool.pytest.ini_options]
testpaths = ["test"]
pythonpath = ["."]
```

- [ ] **Step 4: Create the virtualenv and install**

```bash
cd ~/uk-rent-lookup/data
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

- [ ] **Step 5: Verify pytest works**

Run: `pytest --version`
Expected: a version string ≥ 8.

- [ ] **Step 6: Commit**

```bash
cd ~/uk-rent-lookup
git add data/
git commit -m "chore(data): set up Python project skeleton"
```

### Task 2.2: Define the AreaRent dataclass and source interface

**Files:**
- Create: `data/sources/__init__.py`
- Create: `data/sources/base.py`
- Create: `data/test/__init__.py`
- Create: `data/test/test_base.py`

- [ ] **Step 1: Write the failing test**

Create `data/test/test_base.py`:

```python
from sources.base import AreaRent

def test_area_rent_constructs_with_required_fields():
    rent = AreaRent(
        area_code="E09000033",
        area_name="Westminster",
        area_level="local_authority",
        monthly_rent_gbp=2140,
        period="2026-03",
        source="ONS Private Rent Index",
    )
    assert rent.area_code == "E09000033"
    assert rent.monthly_rent_gbp == 2140
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `cd ~/uk-rent-lookup/data && pytest test/test_base.py -v`
Expected: ImportError, "No module named 'sources'"

- [ ] **Step 3: Create the empty `__init__.py` files**

Create `data/sources/__init__.py` (empty file).
Create `data/test/__init__.py` (empty file).

- [ ] **Step 4: Implement `AreaRent`**

Create `data/sources/base.py`:

```python
from dataclasses import dataclass
from typing import Literal, Protocol

AreaLevel = Literal["local_authority", "region", "country"]


@dataclass(frozen=True)
class AreaRent:
    area_code: str
    area_name: str
    area_level: AreaLevel
    monthly_rent_gbp: int
    period: str  # ISO month, e.g. "2026-03"
    source: str


class RentSource(Protocol):
    name: str

    def fetch(self) -> list[AreaRent]:
        ...
```

- [ ] **Step 5: Run test to confirm it passes**

Run: `pytest test/test_base.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add data/
git commit -m "feat(data): add AreaRent dataclass and RentSource protocol"
```

### Task 2.3: Implement the ONS PIPR source module

**Files:**
- Create: `data/sources/ons.py`
- Create: `data/test/test_ons.py`
- Create: `data/test/fixtures/pipr_table1_sample.xlsx` (small generated test fixture)

The PIPR data is published as a `.xlsx` workbook (`Table 1` is the data sheet, header on row 2 (0-indexed), data from row 3). The download URL is not date-stable — the module must scrape the dataset landing page each run for the current `<a>` link to the workbook.

Reference: `docs/superpowers/research/2026-04-29-data-sources.md` §1.

- [ ] **Step 1: Build a small XLSX test fixture**

A tiny synthetic workbook is sufficient for parser tests — we don't need to commit the 17 MB real file. Run this once to generate the fixture:

```bash
cd ~/uk-rent-lookup/data
source .venv/bin/activate
mkdir -p test/fixtures
python - <<'PY'
import openpyxl
from openpyxl import Workbook
wb = Workbook()
wb.remove(wb.active)
ws = wb.create_sheet("Cover sheet")
ws["A1"] = "Cover"
ws = wb.create_sheet("Contents")
ws["A1"] = "Contents"
ws = wb.create_sheet("Notes")
ws["A1"] = "Notes"
ws = wb.create_sheet("Table 1")
# Two title rows then header on row 3 (1-indexed = row 2 0-indexed)
ws.append(["Price Index of Private Rents", None, None, None, None, None, None, None])
ws.append(["Monthly statistics", None, None, None, None, None, None, None])
ws.append(["Time period", "Area code", "Area name", "Region or country name",
           "Index", "Monthly change", "Annual change", "Rental price"])
# Data rows: two periods for one LA, one regional row, one country row
ws.append(["2026-02-01", "E07000008", "Cambridge", "East of England", 119.5, 0.1, 1.8, 1780])
ws.append(["2026-03-01", "E07000008", "Cambridge", "East of England", 119.7, 0.1, 1.8, 1795])
ws.append(["2026-03-01", "E12000007", "London", "[z]", 124.6, 0.3, 1.7, 2280])
ws.append(["2026-03-01", "K02000001", "United Kingdom", "[z]", 125.0, 0.2, 3.5, 1300])
wb.save("test/fixtures/pipr_table1_sample.xlsx")
print("wrote test/fixtures/pipr_table1_sample.xlsx")
PY
```

- [ ] **Step 2: Write the failing test**

Create `data/test/test_ons.py`:

```python
from pathlib import Path
from sources.ons import parse_pipr_xlsx, find_latest_pipr_url

FIXTURE = Path(__file__).parent / "fixtures" / "pipr_table1_sample.xlsx"


def test_parse_returns_one_row_per_area_for_latest_period():
    rents = parse_pipr_xlsx(FIXTURE.read_bytes())
    by_code = {r.area_code: r for r in rents}
    # Cambridge has two periods in the fixture; only the latest should remain
    assert len(rents) == 3
    assert by_code["E07000008"].period == "2026-03"
    assert by_code["E07000008"].monthly_rent_gbp == 1795


def test_parse_classifies_area_levels():
    rents = parse_pipr_xlsx(FIXTURE.read_bytes())
    by_code = {r.area_code: r for r in rents}
    assert by_code["E07000008"].area_level == "local_authority"
    assert by_code["E12000007"].area_level == "region"
    assert by_code["K02000001"].area_level == "country"


def test_parse_source_attribution():
    rents = parse_pipr_xlsx(FIXTURE.read_bytes())
    assert all(r.source == "ONS Price Index of Private Rents" for r in rents)


def test_find_latest_pipr_url_picks_xlsx_anchor():
    html = '''
        <html><body>
        <a href="/file?uri=/.../priceindexofprivaterentsukmonthlypricestatistics10.xlsx" class="btn--primary">Download</a>
        <a href="/something/else.pdf">Methodology</a>
        </body></html>
    '''
    url = find_latest_pipr_url(html, base="https://www.ons.gov.uk")
    assert url == "https://www.ons.gov.uk/file?uri=/.../priceindexofprivaterentsukmonthlypricestatistics10.xlsx"
```

- [ ] **Step 3: Run test to confirm it fails**

Run: `pytest test/test_ons.py -v`
Expected: ImportError on `sources.ons`.

- [ ] **Step 4: Implement the parser**

Create `data/sources/ons.py`:

```python
"""ONS Price Index of Private Rents (PIPR) source.

PIPR is published as an Excel workbook. The dataset landing page hosts an
<a> linking to the latest workbook; the filename changes each release, so we
scrape the page rather than hard-coding the URL.
"""

import io
from urllib.parse import urljoin

import openpyxl
import requests
from bs4 import BeautifulSoup

from .base import AreaRent

PIPR_LANDING = (
    "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/"
    "priceindexofprivaterentsukmonthlypricestatistics"
)
SHEET_NAME = "Table 1"
HEADER_ROW = 3  # 1-indexed; row 0 and 1 are titles, row 2 is the header


def _infer_area_level(code: str) -> str:
    if code.startswith(("E06", "E07", "E08", "E09", "W06")):
        return "local_authority"
    if code.startswith("E12"):
        return "region"
    if code.startswith(("E92", "W92", "S92", "N92", "K02")):
        return "country"
    # Scotland/Northern Ireland BRMA codes — not used in v1 lookup, classify as country-ish
    return "local_authority"


def _normalize_period(value: object) -> str:
    """Time period column is a datetime in the workbook. Render as ISO month."""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m")
    s = str(value)
    # Already ISO?
    if len(s) >= 7 and s[4] == "-":
        return s[:7]
    return s


def parse_pipr_xlsx(workbook_bytes: bytes) -> list[AreaRent]:
    wb = openpyxl.load_workbook(io.BytesIO(workbook_bytes), read_only=True, data_only=True)
    ws = wb[SHEET_NAME]

    rows_iter = ws.iter_rows(min_row=HEADER_ROW, values_only=True)
    header = next(rows_iter)
    idx = {name: i for i, name in enumerate(header)}
    needed = ["Time period", "Area code", "Area name", "Rental price"]
    for col in needed:
        if col not in idx:
            raise ValueError(f"Expected column {col!r} in {SHEET_NAME}; got {header}")

    # Collect every row, then keep the most recent period per area.
    by_area: dict[str, tuple[str, str, str, int]] = {}
    for row in rows_iter:
        if row is None:
            continue
        code = row[idx["Area code"]]
        rent = row[idx["Rental price"]]
        period_raw = row[idx["Time period"]]
        if code is None or rent is None or period_raw is None:
            continue
        # Skip sentinel values
        if isinstance(rent, str) and rent.strip().startswith("["):
            continue
        try:
            rent_int = int(round(float(rent)))
        except (TypeError, ValueError):
            continue
        code_str = str(code).strip()
        name = str(row[idx["Area name"]]).strip()
        period = _normalize_period(period_raw)
        prev = by_area.get(code_str)
        if prev is None or period > prev[1]:
            by_area[code_str] = (name, period, code_str, rent_int)

    return [
        AreaRent(
            area_code=code_str,
            area_name=name,
            area_level=_infer_area_level(code_str),
            monthly_rent_gbp=rent,
            period=period,
            source="ONS Price Index of Private Rents",
        )
        for (name, period, code_str, rent) in by_area.values()
    ]


def find_latest_pipr_url(landing_html: str, base: str = "https://www.ons.gov.uk") -> str:
    """Find the current PIPR .xlsx download URL by scraping the landing page."""
    soup = BeautifulSoup(landing_html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".xlsx") and "priceindexofprivaterents" in href.lower():
            return urljoin(base, href)
    raise RuntimeError("No PIPR .xlsx anchor found on the landing page")


def fetch_pipr() -> list[AreaRent]:
    """Resolve the current PIPR URL from the landing page and parse the workbook."""
    landing = requests.get(PIPR_LANDING, timeout=30)
    landing.raise_for_status()
    url = find_latest_pipr_url(landing.text)
    workbook = requests.get(url, timeout=120)
    workbook.raise_for_status()
    return parse_pipr_xlsx(workbook.content)
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `pytest test/test_ons.py -v`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add data/
git commit -m "feat(data): add ONS PIPR source (xlsx + landing-page scrape)"
```

### Task 2.4: ~~Land Registry source module~~ — DROPPED

After Task 0.3 research, the Land Registry / ONS PRMS dataset was found to be discontinued (final release Dec 2023, data ~2½ years stale). PIPR (Task 2.3) provides £ rental figures at the same granularity, refreshed monthly. This task is dropped from v1.

The original draft of this task is preserved below for reference only — **do not implement it.**

<details><summary>Original (do not implement)</summary>

**Files:**
- Create: `data/sources/land_registry.py`
- Create: `data/test/test_land_registry.py`
- Create: `data/test/fixtures/lr_sample.csv`

> **Before this task:** Same as Task 2.3 — verify the column names against your research note.

- [ ] **Step 1: Save a fixture**

```bash
curl -s '<Land Registry CSV URL>' | head -20 > data/test/fixtures/lr_sample.csv
```

- [ ] **Step 2: Write the failing test**

Create `data/test/test_land_registry.py`:

```python
from pathlib import Path
from sources.land_registry import parse_lr_csv

FIXTURE = Path(__file__).parent / "fixtures" / "lr_sample.csv"


def test_parse_returns_at_least_one_row():
    rents = parse_lr_csv(FIXTURE.read_text())
    assert len(rents) > 0


def test_parse_includes_only_local_authority_level():
    rents = parse_lr_csv(FIXTURE.read_text())
    assert all(r.area_level == "local_authority" for r in rents)


def test_parse_source_attribution():
    rents = parse_lr_csv(FIXTURE.read_text())
    assert all(r.source == "HM Land Registry" for r in rents)
```

- [ ] **Step 3: Run test to confirm it fails**

Run: `pytest test/test_land_registry.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement the parser**

Create `data/sources/land_registry.py`. Substitute the column names from your research:

```python
import io
import pandas as pd
from .base import AreaRent

COL_AREA_CODE = "<verify-from-research>"
COL_AREA_NAME = "<verify-from-research>"
COL_MEDIAN_RENT = "<verify-from-research>"
COL_PERIOD = "<verify-from-research>"


def parse_lr_csv(csv_text: str) -> list[AreaRent]:
    df = pd.read_csv(io.StringIO(csv_text))
    df = df.dropna(subset=[COL_AREA_CODE, COL_MEDIAN_RENT, COL_PERIOD])
    df = df.sort_values(COL_PERIOD).groupby(COL_AREA_CODE, as_index=False).last()
    return [
        AreaRent(
            area_code=str(row[COL_AREA_CODE]),
            area_name=str(row[COL_AREA_NAME]),
            area_level="local_authority",
            monthly_rent_gbp=int(round(float(row[COL_MEDIAN_RENT]))),
            period=str(row[COL_PERIOD]),
            source="HM Land Registry",
        )
        for _, row in df.iterrows()
    ]


def fetch_lr(url: str) -> list[AreaRent]:
    import requests
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return parse_lr_csv(resp.text)
```

- [ ] **Step 5: Run tests**

Run: `pytest test/test_land_registry.py -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add data/
git commit -m "feat(data): add HM Land Registry rentals parser"
```

</details>

### Task 2.5: Implement the orchestrator

**Files:**
- Create: `data/pipeline.py`
- Create: `data/test/test_pipeline.py`

The orchestrator takes a list of `AreaRent` from the PIPR source, deduplicates by `area_code` (the source already does this, but we re-assert it here), and writes the JSON lookup.

- [ ] **Step 1: Write the failing test**

Create `data/test/test_pipeline.py`:

```python
import json
from pipeline import build_lookup, write_lookup
from sources.base import AreaRent


def _make(code, name, rent, level="local_authority", period="2026-03"):
    return AreaRent(
        area_code=code, area_name=name, area_level=level,
        monthly_rent_gbp=rent, period=period,
        source="ONS Price Index of Private Rents",
    )


def test_build_lookup_keys_by_area_code():
    rents = [_make("E09000033", "Westminster", 2140)]
    result = build_lookup(rents=rents)
    assert "E09000033" in result
    assert result["E09000033"]["monthly_rent_gbp"] == 2140
    assert result["E09000033"]["area_name"] == "Westminster"


def test_build_lookup_keeps_region_codes_for_auto_widen():
    rents = [_make("E12000007", "London", 2280, level="region")]
    result = build_lookup(rents=rents)
    assert result["E12000007"]["area_level"] == "region"


def test_build_lookup_dedupes_when_same_code_appears_twice():
    rents = [
        _make("E09000033", "Westminster", 2100, period="2026-02"),
        _make("E09000033", "Westminster", 2140, period="2026-03"),
    ]
    result = build_lookup(rents=rents)
    # Latest period wins
    assert result["E09000033"]["monthly_rent_gbp"] == 2140
    assert result["E09000033"]["period"] == "2026-03"


def test_write_lookup_produces_readable_json(tmp_path):
    out = tmp_path / "rents.json"
    write_lookup({"E09000033": {"foo": "bar"}}, out)
    parsed = json.loads(out.read_text())
    assert parsed["E09000033"]["foo"] == "bar"
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pytest test/test_pipeline.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement the orchestrator**

Create `data/pipeline.py`:

```python
import json
import sys
from pathlib import Path

from sources.base import AreaRent
from sources.ons import fetch_pipr


def build_lookup(*, rents: list[AreaRent]) -> dict:
    """Build a lookup keyed by area_code. If duplicates appear, latest period wins."""
    by_code: dict[str, dict] = {}
    by_code_period: dict[str, str] = {}
    for r in rents:
        prev_period = by_code_period.get(r.area_code)
        if prev_period is not None and prev_period >= r.period:
            continue
        by_code[r.area_code] = {
            "area_name": r.area_name,
            "area_level": r.area_level,
            "monthly_rent_gbp": r.monthly_rent_gbp,
            "period": r.period,
            "source": r.source,
        }
        by_code_period[r.area_code] = r.period
    return by_code


def write_lookup(lookup: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(lookup, indent=2, sort_keys=True))


def main() -> int:
    print("Fetching PIPR...", file=sys.stderr)
    rents = fetch_pipr()
    print(f"Fetched {len(rents)} PIPR rows.", file=sys.stderr)
    lookup = build_lookup(rents=rents)
    out_path = Path(__file__).resolve().parent.parent / "worker" / "data" / "rents.json"
    write_lookup(lookup, out_path)
    print(f"Wrote {len(lookup)} entries to {out_path}.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests**

Run: `pytest test/ -v`
Expected: all 8 PASS (1 base + 4 ons + 0 LR (dropped) + 4 pipeline... actually let me recount: 1 base + 4 ons + 4 pipeline = 9. If you wrote 1 base test, 4 ons tests, and 4 pipeline tests, that's 9 PASS).

- [ ] **Step 5: Commit**

```bash
git add data/
git commit -m "feat(data): add pipeline orchestrator (PIPR-only)"
```

### Task 2.6: Run the pipeline end-to-end and commit the first rents.json

**Files:**
- Create: `worker/data/rents.json` (generated)

- [ ] **Step 1: Run the pipeline locally**

```bash
cd ~/uk-rent-lookup/data
source .venv/bin/activate
python pipeline.py
```

Expected stderr: "Fetching PIPR..." then "Fetched N PIPR rows... Wrote K entries to .../worker/data/rents.json."

- [ ] **Step 2: Sanity-check the output**

```bash
cd ~/uk-rent-lookup
python3 -c "import json; d=json.load(open('worker/data/rents.json')); print(len(d), 'entries'); print(d.get('E09000033'))"
```

Expected: a count > 300 (UK has ~330 local authorities), and a Westminster entry with a sensible figure (1500–3000 range).

- [ ] **Step 3: Commit**

```bash
git add worker/data/rents.json
git commit -m "chore(data): commit initial rents.json"
```

### Task 2.7: GitHub Actions cron for monthly refresh

**Files:**
- Create: `.github/workflows/refresh-data.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Refresh rent data
on:
  schedule:
    - cron: "0 3 1 * *"  # 03:00 UTC, 1st of every month
  workflow_dispatch: {}  # allow manual runs

jobs:
  refresh:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: pip
          cache-dependency-path: data/requirements-dev.txt

      - name: Install dependencies
        working-directory: data
        run: pip install -r requirements-dev.txt

      - name: Run pipeline tests
        working-directory: data
        run: pytest -v

      - name: Run pipeline
        working-directory: data
        run: python pipeline.py

      - name: Open PR if data changed
        uses: peter-evans/create-pull-request@v6
        with:
          commit-message: "data: refresh ${{ github.run_id }}"
          branch: data-refresh-${{ github.run_id }}
          title: "data: monthly refresh"
          body: "Automated refresh of `worker/data/rents.json` from ONS + Land Registry."
          delete-branch: true
```

- [ ] **Step 2: ~~Configure repo variables~~ — not needed**

PIPR pipeline scrapes the landing page each run; no URL secrets to configure. Skip to Step 3.

- [ ] **Step 3: Commit and push**

```bash
git add .github/
git commit -m "ci: add monthly data refresh workflow"
git push
```

- [ ] **Step 4: Test the workflow manually**

Run: `gh workflow run "Refresh rent data"`
Then: `gh run watch`
Expected: green run. A PR named "data: monthly refresh" should appear (it may be empty if data hasn't changed, that's fine).

---

## Phase 3 — Cloudflare Worker

### Task 3.1: Initialize the Worker project

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`

- [ ] **Step 1: Scaffold with wrangler**

```bash
cd ~/uk-rent-lookup
npm create cloudflare@latest worker -- \
  --type=hello-world \
  --ts=true \
  --git=false \
  --deploy=false \
  --no-deploy
```

When prompted, accept defaults except: pick **TypeScript**, do **not** initialize git, do **not** deploy yet.

- [ ] **Step 2: Replace `worker/wrangler.toml`** with:

```toml
name = "uk-rent-lookup"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[[rules]]
type = "Text"
globs = ["**/*.json"]
fallthrough = false
```

(The `[[rules]]` block bundles `data/rents.json` into the Worker so it can be imported as a string at build time.)

- [ ] **Step 3: Add testing dependencies**

```bash
cd worker
npm install --save-dev vitest @cloudflare/vitest-pool-workers
```

- [ ] **Step 4: Add a `test` script**

Edit `worker/package.json` and add `"test": "vitest run"` to the `scripts` block.

- [ ] **Step 5: Commit**

```bash
cd ~/uk-rent-lookup
git add worker/
git commit -m "chore(worker): scaffold Cloudflare Worker"
```

### Task 3.2: Postcode normalization and validation (TDD)

**Files:**
- Create: `worker/src/postcode.ts`
- Create: `worker/test/postcode.test.ts`
- Create: `worker/vitest.config.ts`

- [ ] **Step 1: Vitest config**

Create `worker/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write failing tests**

Create `worker/test/postcode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalize, isValid } from "../src/postcode";

describe("normalize", () => {
  it("uppercases and removes whitespace", () => {
    expect(normalize("sw1a 1aa")).toBe("SW1A1AA");
  });
  it("handles outward-only postcodes", () => {
    expect(normalize("sw1a")).toBe("SW1A");
  });
  it("collapses multiple spaces", () => {
    expect(normalize("  sw1a   1aa  ")).toBe("SW1A1AA");
  });
});

describe("isValid", () => {
  it("accepts standard full postcodes", () => {
    expect(isValid("SW1A1AA")).toBe(true);
    expect(isValid("M11AE")).toBe(true);
    expect(isValid("EH12NG")).toBe(true);
  });
  it("accepts outward-only postcodes", () => {
    expect(isValid("SW1A")).toBe(true);
    expect(isValid("EH1")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValid("XYZ")).toBe(false);
    expect(isValid("12345")).toBe(false);
    expect(isValid("")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `cd ~/uk-rent-lookup/worker && npm test`
Expected: failures with "Cannot find module ../src/postcode".

- [ ] **Step 4: Implement**

Create `worker/src/postcode.ts`:

```ts
const FULL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const OUTWARD_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

export function normalize(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function isValid(normalized: string): boolean {
  return FULL_POSTCODE_RE.test(normalized) || OUTWARD_RE.test(normalized);
}
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npm test`
Expected: 7 PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/uk-rent-lookup
git add worker/
git commit -m "feat(worker): add postcode normalize/validate"
```

### Task 3.3: Postcode → area resolution via postcodes.io (TDD)

**Files:**
- Create: `worker/src/area.ts`
- Create: `worker/test/area.test.ts`

- [ ] **Step 1: Write failing tests**

Create `worker/test/area.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveArea, AreaResolutionError } from "../src/area";

const ok = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
const err = (status: number) => Promise.resolve(new Response("", { status }));

describe("resolveArea", () => {
  it("returns admin_district code on success", async () => {
    const fetchMock = vi.fn().mockReturnValue(
      ok({ status: 200, result: { codes: { admin_district: "E09000033" } } })
    );
    const code = await resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch);
    expect(code).toBe("E09000033");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.postcodes.io/postcodes/SW1A1AA",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("throws postcode_not_found on 404", async () => {
    const fetchMock = vi.fn().mockReturnValue(err(404));
    await expect(resolveArea("ZZ99ZZ", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("postcode_not_found"));
  });

  it("throws lookup_temporarily_unavailable on 5xx", async () => {
    const fetchMock = vi.fn().mockReturnValue(err(503));
    await expect(resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("lookup_temporarily_unavailable"));
  });

  it("throws lookup_temporarily_unavailable on network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("lookup_temporarily_unavailable"));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test`
Expected: failures importing `../src/area`.

- [ ] **Step 3: Implement**

Create `worker/src/area.ts`:

```ts
export type AreaErrorCode =
  | "postcode_not_found"
  | "lookup_temporarily_unavailable";

export class AreaResolutionError extends Error {
  constructor(public readonly code: AreaErrorCode) {
    super(code);
  }
}

const POSTCODES_IO_TIMEOUT_MS = 3000;

export async function resolveArea(
  postcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POSTCODES_IO_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      { signal: controller.signal },
    );
    if (resp.status === 404) {
      throw new AreaResolutionError("postcode_not_found");
    }
    if (!resp.ok) {
      throw new AreaResolutionError("lookup_temporarily_unavailable");
    }
    const body = (await resp.json()) as {
      result?: { codes?: { admin_district?: string } };
    };
    const code = body.result?.codes?.admin_district;
    if (!code) {
      throw new AreaResolutionError("postcode_not_found");
    }
    return code;
  } catch (e) {
    if (e instanceof AreaResolutionError) throw e;
    throw new AreaResolutionError("lookup_temporarily_unavailable");
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/uk-rent-lookup
git add worker/
git commit -m "feat(worker): resolve postcode to local-authority code"
```

### Task 3.4: Lookup with auto-widen (TDD)

**Files:**
- Create: `worker/src/lookup.ts`
- Create: `worker/test/lookup.test.ts`

- [ ] **Step 1: Write failing tests**

Create `worker/test/lookup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lookupRent } from "../src/lookup";

const TABLE = {
  E09000033: {
    area_name: "Westminster",
    area_level: "local_authority",
    monthly_rent_gbp: 2140,
    period: "2026-03",
    source: "HM Land Registry",
  },
  E12000007: {
    area_name: "London",
    area_level: "region",
    monthly_rent_gbp: 1850,
    period: "2026-03",
    source: "ONS Private Rent Index",
  },
};

// Mapping from local-authority code → parent region code (subset for tests)
const REGIONS = {
  E09000033: "E12000007", // Westminster → London
  E08000026: "E12000005", // Coventry → West Midlands
};

describe("lookupRent", () => {
  it("returns local-authority match when present", () => {
    const r = lookupRent("E09000033", TABLE, REGIONS);
    expect(r).toEqual({
      area: "Westminster",
      area_level: "local_authority",
      monthly_rent_gbp: 2140,
      period: "2026-03",
      source: "HM Land Registry",
    });
  });

  it("auto-widens to parent region when LA missing", () => {
    const r = lookupRent("E08000026", TABLE, REGIONS); // Coventry not in table
    expect(r).toBeNull(); // West Midlands also not in TABLE for this test
  });

  it("auto-widens to region when LA missing but region is in table", () => {
    const tableWithoutLA = { E12000007: TABLE.E12000007 };
    const r = lookupRent("E09000033", tableWithoutLA, REGIONS);
    expect(r?.area).toBe("London");
    expect(r?.area_level).toBe("region");
  });

  it("returns null when neither LA nor region known", () => {
    expect(lookupRent("UNKNOWN", TABLE, REGIONS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test`
Expected: import errors.

- [ ] **Step 3: Implement**

Create `worker/src/lookup.ts`:

```ts
export interface RentEntry {
  area_name: string;
  area_level: "local_authority" | "region" | "country";
  monthly_rent_gbp: number;
  period: string;
  source: string;
}

export interface RentResult {
  area: string;
  area_level: "local_authority" | "region" | "country";
  monthly_rent_gbp: number;
  period: string;
  source: string;
}

export function lookupRent(
  areaCode: string,
  table: Record<string, RentEntry>,
  regions: Record<string, string>,
): RentResult | null {
  const direct = table[areaCode];
  if (direct) {
    return {
      area: direct.area_name,
      area_level: direct.area_level,
      monthly_rent_gbp: direct.monthly_rent_gbp,
      period: direct.period,
      source: direct.source,
    };
  }
  const parent = regions[areaCode];
  if (parent && table[parent]) {
    const r = table[parent];
    return {
      area: r.area_name,
      area_level: r.area_level,
      monthly_rent_gbp: r.monthly_rent_gbp,
      period: r.period,
      source: r.source,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/uk-rent-lookup
git add worker/
git commit -m "feat(worker): add rent lookup with auto-widen to region"
```

### Task 3.5: Generate the local-authority → region map

**Files:**
- Create: `worker/data/regions.json`
- Modify: `data/pipeline.py` (extend it to also emit `regions.json`)

Source confirmed in research note §3: ONS Open Geography Portal "Local Authority District to Region (December 2024) lookup in EN", served as CSV.

- [ ] **Step 1: Add the regions function to the pipeline**

Edit `data/pipeline.py`. Add at the top:

```python
import io
import requests
```

Add this function:

```python
LAD_TO_RGN_URL = (
    "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/"
    "3959874c514b470e9dd160acdc00c97a/csv?layers=0"
)


def fetch_regions() -> dict[str, str]:
    """Download ONS LAD24CD → RGN24CD lookup; return { LAD_code: RGN_code }."""
    import pandas as pd  # local import keeps pandas optional for unit tests
    resp = requests.get(LAD_TO_RGN_URL, timeout=60)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.content.decode("utf-8-sig")))
    return dict(zip(df["LAD24CD"].astype(str), df["RGN24CD"].astype(str)))
```

Then in `main()`, after the rents lookup is written, add:

```python
print("Fetching regions lookup...", file=sys.stderr)
regions = fetch_regions()
regions_path = Path(__file__).resolve().parent.parent / "worker" / "data" / "regions.json"
regions_path.parent.mkdir(parents=True, exist_ok=True)
regions_path.write_text(json.dumps(regions, indent=2, sort_keys=True))
print(f"Wrote {len(regions)} regions to {regions_path}.", file=sys.stderr)
```

- [ ] **Step 2: Run the pipeline**

```bash
cd ~/uk-rent-lookup/data
source .venv/bin/activate
python pipeline.py
```

- [ ] **Step 3: Sanity check**

```bash
python3 -c "import json; d=json.load(open('../worker/data/regions.json')); print(len(d), 'mappings'); print('Westminster ->', d.get('E09000033'))"
```

Expected: ~296 mappings (Dec 2024 vintage, England-only); Westminster → `E12000007`.

- [ ] **Step 4: Commit**

```bash
cd ~/uk-rent-lookup
git add data/ worker/data/
git commit -m "feat(data): emit local-authority to region lookup"
```

### Task 3.6: Wire it all together as the `/lookup` endpoint

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/test/index.test.ts`

- [ ] **Step 1: Replace `worker/src/index.ts`**

```ts
import { normalize, isValid } from "./postcode";
import { resolveArea, AreaResolutionError } from "./area";
import { lookupRent, RentEntry } from "./lookup";

import rentsJson from "../data/rents.json";
import regionsJson from "../data/regions.json";

const RENTS = rentsJson as Record<string, RentEntry>;
const REGIONS = regionsJson as Record<string, string>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(req.url);
    if (url.pathname !== "/lookup") {
      return json({ error: "not_found" }, 404);
    }
    const raw = url.searchParams.get("postcode");
    if (!raw) return json({ error: "missing_postcode" }, 400);

    const normalized = normalize(raw);
    if (!isValid(normalized)) return json({ error: "invalid_postcode" }, 400);

    let areaCode: string;
    try {
      areaCode = await resolveArea(normalized);
    } catch (e) {
      if (e instanceof AreaResolutionError) {
        const status = e.code === "postcode_not_found" ? 404 : 503;
        return json({ error: e.code }, status);
      }
      return json({ error: "internal_error" }, 500);
    }

    const result = lookupRent(areaCode, RENTS, REGIONS);
    if (!result) return json({ error: "no_data" }, 404);

    return json({
      ...result,
      currency: "GBP",
      period_unit: "monthly",
    });
  },
};
```

- [ ] **Step 2: Add an integration-style test**

Create `worker/test/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

// Helper to stub global fetch
function stubFetch(impl: (input: RequestInfo | URL) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

describe("/lookup endpoint", () => {
  it("returns 400 invalid_postcode for garbage", async () => {
    const res = await worker.fetch(new Request("https://x/lookup?postcode=XYZ"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_postcode" });
  });

  it("returns 400 missing_postcode when omitted", async () => {
    const res = await worker.fetch(new Request("https://x/lookup"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown path", async () => {
    const res = await worker.fetch(new Request("https://x/other"));
    expect(res.status).toBe(404);
  });

  it("returns 503 when postcodes.io is down", async () => {
    stubFetch(() =>
      Promise.resolve(new Response("", { status: 503 }))
    );
    const res = await worker.fetch(new Request("https://x/lookup?postcode=SW1A1AA"));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd ~/uk-rent-lookup/worker && npm test`
Expected: all PASS (postcode + area + lookup + index).

- [ ] **Step 4: Run the Worker locally**

Run: `npx wrangler dev`
In another terminal: `curl 'http://localhost:8787/lookup?postcode=SW1A%201AA'`
Expected: a JSON body with `area`, `monthly_rent_gbp`, `source`, `period`, `period_unit: "monthly"`.

- [ ] **Step 5: Commit**

```bash
cd ~/uk-rent-lookup
git add worker/
git commit -m "feat(worker): wire /lookup endpoint with full pipeline"
```

### Task 3.7: Deploy the Worker

**Files:** none

- [ ] **Step 1: Deploy**

```bash
cd ~/uk-rent-lookup/worker
npx wrangler deploy
```

Expected: a deployment URL of the form `https://uk-rent-lookup.<your-subdomain>.workers.dev`.

- [ ] **Step 2: Smoke test the deployed Worker**

Run (substituting your actual URL):
```bash
curl 'https://uk-rent-lookup.<your-subdomain>.workers.dev/lookup?postcode=SW1A%201AA'
curl 'https://uk-rent-lookup.<your-subdomain>.workers.dev/lookup?postcode=XYZ'
curl 'https://uk-rent-lookup.<your-subdomain>.workers.dev/lookup?postcode=ZZ99%209ZZ'
```

Expected:
- First: 200 with rent data
- Second: 400 invalid_postcode
- Third: 404 postcode_not_found

- [ ] **Step 3: Save the Worker URL**

You'll need it for the frontend. Note it in your shell scratchpad.

---

## Phase 4 — Frontend

### Task 4.1: Build the static page

**Files:**
- Create: `web/index.html`
- Create: `web/style.css`
- Create: `web/app.js`

- [ ] **Step 1: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UK Rent Lookup</title>
  <meta name="description" content="Average monthly rent for any UK postcode, sourced from official government data." />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <header>
      <h1>UK Rent Lookup</h1>
      <p class="tagline">Average monthly rent for your area, from official UK data.</p>
    </header>

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

    <section id="result" hidden></section>
    <section id="error" hidden></section>

    <footer>
      <p>
        Data: <a href="https://www.ons.gov.uk" target="_blank" rel="noopener">ONS</a> &middot;
        <a href="https://www.gov.uk/government/organisations/land-registry" target="_blank" rel="noopener">HM Land Registry</a>.
        Postcode lookup by <a href="https://postcodes.io" target="_blank" rel="noopener">postcodes.io</a>.
      </p>
      <p>Figures are area averages. Not a valuation of any specific property.</p>
    </footer>
  </main>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `web/style.css`**

```css
:root {
  --fg: #1a1a1a;
  --fg-muted: #666;
  --bg: #fafafa;
  --accent: #3b82f6;
  --accent-bg: #f0f6ff;
  --error-bg: #fff1f0;
  --error-fg: #b00020;
  --border: #e5e5e5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

main {
  max-width: 560px;
  width: 100%;
  text-align: center;
}

header h1 {
  font-size: 28px;
  margin: 0 0 6px;
}

.tagline {
  color: var(--fg-muted);
  margin: 0 0 32px;
}

form {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}

input[type="text"] {
  flex: 1;
  padding: 12px 14px;
  font-size: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: white;
}

input[type="text"]:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

button {
  padding: 12px 18px;
  font-size: 16px;
  font-weight: 600;
  background: var(--accent);
  color: white;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

button:disabled { opacity: 0.6; cursor: progress; }

#result {
  text-align: left;
  background: var(--accent-bg);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: 16px 18px;
}

#result .area { font-size: 14px; color: var(--fg); }
#result .figure { font-size: 28px; font-weight: 600; margin: 4px 0; }
#result .meta { font-size: 12px; color: var(--fg-muted); }

#error {
  text-align: left;
  background: var(--error-bg);
  color: var(--error-fg);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 14px;
}

footer {
  margin-top: 64px;
  font-size: 12px;
  color: var(--fg-muted);
}
footer a { color: var(--fg-muted); }
```

- [ ] **Step 3: Create `web/app.js`**

```js
const WORKER_URL = "https://uk-rent-lookup.<your-subdomain>.workers.dev"; // ← replace
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

const form = document.getElementById("lookup-form");
const input = document.getElementById("postcode");
const submit = form.querySelector("button");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");

function showResult(data) {
  errorEl.hidden = true;
  const widened = data.area_level !== "local_authority";
  resultEl.innerHTML = `
    <div class="area">Average rent in <strong>${escapeHtml(data.area)}</strong>${
    widened ? ` <em>(showing data for the wider ${escapeHtml(data.area_level.replace("_", " "))})</em>` : ""
  }</div>
    <div class="figure">${POUND.format(data.monthly_rent_gbp)} / month</div>
    <div class="meta">${escapeHtml(data.source)} &middot; period ${escapeHtml(
    data.period
  )}</div>
  `;
  resultEl.hidden = false;
}

function showError(code) {
  resultEl.hidden = true;
  errorEl.textContent = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error;
  errorEl.hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pc = input.value.trim();
  if (!pc) return showError("missing_postcode");
  submit.disabled = true;
  try {
    const resp = await fetch(
      `${WORKER_URL}/lookup?postcode=${encodeURIComponent(pc)}`
    );
    const body = await resp.json();
    if (!resp.ok) return showError(body.error ?? "internal_error");
    showResult(body);
  } catch {
    showError("network");
  } finally {
    submit.disabled = false;
  }
});
```

- [ ] **Step 4: Replace `<your-subdomain>` in `app.js`**

Edit the `WORKER_URL` constant with the actual URL from Task 3.7 step 3.

- [ ] **Step 5: Test locally**

```bash
cd ~/uk-rent-lookup/web
python3 -m http.server 8000
```
Open http://localhost:8000 in a browser. Try `SW1A 1AA`, `XYZ`, `ZZ99 9ZZ`. Confirm the three states render correctly.

- [ ] **Step 6: Commit**

```bash
cd ~/uk-rent-lookup
git add web/
git commit -m "feat(web): static frontend page"
```

### Task 4.2: Deploy to Cloudflare Pages

**Files:** none

- [ ] **Step 1: Connect the GitHub repo to Cloudflare Pages**

In a browser:
1. Open https://dash.cloudflare.com → Workers & Pages → Create application → Pages → Connect to Git.
2. Select your `uk-rent-lookup` repository.
3. Build configuration:
   - **Production branch:** `main`
   - **Build command:** *(leave blank)*
   - **Build output directory:** `web`
4. Save and Deploy.

- [ ] **Step 2: Note the Pages URL**

After ~30 seconds the dashboard shows a URL of the form `https://uk-rent-lookup.pages.dev`. Click it.

- [ ] **Step 3: Smoke test in the browser**

Try the four postcodes from your manual smoke test:
- `SW1A 1AA` (Westminster) — should return data
- `LL55 4UN` (Snowdonia, rural Welsh) — should return data, possibly auto-widened
- `EH1 1YZ` (Edinburgh) — should return data
- `XYZ` — should show "doesn't look like a UK postcode"

If any fail, check the browser console for the actual error response.

---

## Phase 5 — Polish and verification

### Task 5.1: Add bot/SEO basics

**Files:**
- Create: `web/robots.txt`
- Modify: `web/index.html`

- [ ] **Step 1: Create `web/robots.txt`**

```
User-agent: *
Allow: /
```

- [ ] **Step 2: Add Open Graph tags** (optional but cheap)

In `web/index.html`, inside `<head>` after the description meta:

```html
<meta property="og:title" content="UK Rent Lookup" />
<meta property="og:description" content="Average monthly rent for any UK postcode, sourced from official UK data." />
<meta property="og:type" content="website" />
```

- [ ] **Step 3: Commit and deploy** (Pages auto-deploys on push)

```bash
cd ~/uk-rent-lookup
git add web/
git commit -m "chore(web): add robots.txt and Open Graph"
git push
```

### Task 5.2: Document the project in `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`** with:

```markdown
# UK Rent Lookup

Live: https://uk-rent-lookup.pages.dev

A free site that returns the average monthly rent for any UK postcode, sourced from official UK datasets.

## How it works

- **Frontend** ([`web/`](web/)) — static HTML/CSS/JS hosted on Cloudflare Pages.
- **Worker** ([`worker/`](worker/)) — TypeScript Cloudflare Worker exposing `GET /lookup?postcode=…`. Resolves the postcode via [postcodes.io](https://postcodes.io), then reads from a bundled JSON lookup table.
- **Data pipeline** ([`data/`](data/)) — Python script that downloads ONS Private Rent Index and HM Land Registry rentals data, joins them, and writes [`worker/data/rents.json`](worker/data/rents.json). Runs monthly via [GitHub Actions](.github/workflows/refresh-data.yml).

See [the design spec](docs/superpowers/specs/2026-04-29-uk-rent-lookup-design.md) for full architecture.

## Local development

### Worker

\`\`\`bash
cd worker
npm install
npm test
npx wrangler dev
\`\`\`

### Data pipeline

\`\`\`bash
cd data
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
\`\`\`

### Frontend

\`\`\`bash
cd web
python3 -m http.server 8000
\`\`\`

## Deploying

- **Frontend** auto-deploys on push to `main` (Cloudflare Pages).
- **Worker** deploys via `cd worker && npx wrangler deploy`.
- **Data refresh** runs on the 1st of every month, or manually via `gh workflow run "Refresh rent data"`.

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs: write README"
git push
```

### Task 5.3: Final manual smoke test

**Files:** none

- [ ] **Step 1: Run the four-postcode checklist in the live browser**

Open `https://uk-rent-lookup.pages.dev` and verify:

| Postcode | Expected | Pass? |
|---|---|---|
| `SW1A 1AA` | London / Westminster figure | |
| `LL55 4UN` | A Welsh / rural figure (may be region-widened) | |
| `EH1 1YZ` | An Edinburgh / Scotland figure (or "no data" with widen note) | |
| `XYZ` | "That doesn't look like a UK postcode." | |

- [ ] **Step 2: Confirm the source citation is visible**

Each result must show: source name, period, footer with ONS / Land Registry / postcodes.io credits.

- [ ] **Step 3: Confirm the auto-widen notice appears for an out-of-coverage postcode**

If you found one in step 1 that auto-widened, it should say "showing data for the wider region".

If everything passes, **the v1 site is live.**

---

## Self-review

Performed against the spec [docs/superpowers/specs/2026-04-29-uk-rent-lookup-design.md](../specs/2026-04-29-uk-rent-lookup-design.md):

| Spec section | Covered by |
|---|---|
| §4 Architecture: 3 components, edge cache | Tasks 3.1, 3.6 (Cache-Control), 4.1, Phase 2 |
| §5.1 Frontend (HTML/CSS/JS, Pages) | Tasks 4.1, 4.2 |
| §5.2 Worker (TypeScript, /lookup endpoint, edge cache) | Tasks 3.1–3.7 |
| §5.3 Data pipeline (ONS + LR, source-module abstraction) | Tasks 2.1–2.7 |
| §5.4 Repo layout | Tasks 1.1, 2.1, 3.1, 4.1 |
| §6.1 Request path (validate→resolve→lookup→auto-widen) | Tasks 3.2, 3.3, 3.4, 3.6 |
| §6.2 Refresh path (monthly cron, PR-based) | Task 2.7 |
| §7 Error handling table (every row) | Tasks 3.2, 3.3, 3.4, 3.6 (worker side); Task 4.1 (frontend renderer) |
| §8.1 Worker unit tests | Tasks 3.2, 3.3, 3.4, 3.6 |
| §8.2 Pipeline tests | Tasks 2.2, 2.3, 2.4, 2.5 |
| §8.3 Manual smoke test | Task 5.3 |
| §9 Operations / monitoring | Documented in spec; no code needed for v1 |
| §11 Open question: ONS/LR URLs | Task 0.3 (research note) |
| §11 Open question: LAD↔region map | Task 3.5 |

**Placeholder scan:** All `<verify-from-research>` markers are intentional — they refer to literal column names that depend on research output captured in Task 0.3. Each is paired with a comment naming what the column represents, and the surrounding code is otherwise concrete. No "TBD" / "TODO" / "implement later" markers.

**Type consistency:** `RentEntry`, `RentResult`, `AreaResolutionError`, `AreaErrorCode` defined in single locations (`lookup.ts`, `area.ts`) and consistently imported. `lookupRent(areaCode, table, regions)` signature matches across `lookup.ts` and `index.ts`. The error code strings (`invalid_postcode`, `postcode_not_found`, `lookup_temporarily_unavailable`, `no_data`, `internal_error`, `missing_postcode`, `network`) match exactly between Worker (`index.ts`) and frontend (`app.js`'s `ERROR_MESSAGES`).
