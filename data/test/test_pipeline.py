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
    assert result["E09000033"]["monthly_rent_gbp"] == 2140
    assert result["E09000033"]["period"] == "2026-03"


def test_build_lookup_dedupes_regardless_of_input_order():
    """Same as above but with the latest period coming first in the input."""
    rents = [
        _make("E09000033", "Westminster", 2140, period="2026-03"),
        _make("E09000033", "Westminster", 2100, period="2026-02"),
    ]
    result = build_lookup(rents=rents)
    assert result["E09000033"]["monthly_rent_gbp"] == 2140


def test_write_lookup_produces_readable_json(tmp_path):
    out = tmp_path / "rents.json"
    write_lookup({"E09000033": {"foo": "bar"}}, out)
    parsed = json.loads(out.read_text())
    assert parsed["E09000033"]["foo"] == "bar"
