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
HEADER_ROW = 3  # 1-indexed; rows 1 and 2 are titles, row 3 is the header


def _infer_area_level(code: str) -> str:
    if code.startswith(("E06", "E07", "E08", "E09", "W06")):
        return "local_authority"
    if code.startswith("E12"):
        return "region"
    if code.startswith(("E92", "W92", "S92", "N92", "K02")):
        return "country"
    return "local_authority"


def _normalize_period(value: object) -> str:
    """Time period column is a datetime in the workbook. Render as ISO month."""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m")
    s = str(value)
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

    by_area: dict[str, tuple[str, str, int]] = {}
    for row in rows_iter:
        if row is None:
            continue
        code = row[idx["Area code"]]
        rent = row[idx["Rental price"]]
        period_raw = row[idx["Time period"]]
        if code is None or rent is None or period_raw is None:
            continue
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
        if prev is None or period > prev[0]:
            by_area[code_str] = (period, name, rent_int)

    return [
        AreaRent(
            area_code=code_str,
            area_name=name,
            area_level=_infer_area_level(code_str),
            monthly_rent_gbp=rent,
            period=period,
            source="ONS Price Index of Private Rents",
        )
        for code_str, (period, name, rent) in by_area.items()
    ]


def find_latest_pipr_url(landing_html: str, base: str = "https://www.ons.gov.uk") -> str:
    soup = BeautifulSoup(landing_html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".xlsx") and "priceindexofprivaterents" in href.lower():
            return urljoin(base, href)
    raise RuntimeError("No PIPR .xlsx anchor found on the landing page")


def fetch_pipr() -> list[AreaRent]:
    landing = requests.get(PIPR_LANDING, timeout=30)
    landing.raise_for_status()
    url = find_latest_pipr_url(landing.text)
    workbook = requests.get(url, timeout=120)
    workbook.raise_for_status()
    return parse_pipr_xlsx(workbook.content)
