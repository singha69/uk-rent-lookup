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
