import json
import sys
import io
import requests
from pathlib import Path

from sources.base import AreaRent
from sources.ons import fetch_pipr

LAD_TO_RGN_URL = (
    "https://open-geography-portalx-ons.hub.arcgis.com/api/download/v1/items/"
    "3959874c514b470e9dd160acdc00c97a/csv?layers=0"
)


def fetch_regions() -> dict[str, str]:
    """Download ONS LAD24CD → RGN24CD lookup; return { LAD_code: RGN_code }."""
    import pandas as pd
    resp = requests.get(LAD_TO_RGN_URL, timeout=60)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.content.decode("utf-8-sig")))
    return dict(zip(df["LAD24CD"].astype(str), df["RGN24CD"].astype(str)))


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
    print("Fetching regions lookup...", file=sys.stderr)
    regions = fetch_regions()
    regions_path = Path(__file__).resolve().parent.parent / "worker" / "data" / "regions.json"
    regions_path.parent.mkdir(parents=True, exist_ok=True)
    regions_path.write_text(json.dumps(regions, indent=2, sort_keys=True))
    print(f"Wrote {len(regions)} regions to {regions_path}.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
