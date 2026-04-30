from pathlib import Path
from sources.ons import parse_pipr_xlsx, find_latest_pipr_url

FIXTURE = Path(__file__).parent / "fixtures" / "pipr_table1_sample.xlsx"


def test_parse_returns_one_row_per_area_for_latest_period():
    rents = parse_pipr_xlsx(FIXTURE.read_bytes())
    by_code = {r.area_code: r for r in rents}
    # Cambridge has two periods; only the latest should remain.
    # Suppressed-rent row should be skipped.
    assert set(by_code.keys()) == {"E07000008", "E12000007", "K02000001"}
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


def test_parse_skips_sentinel_rent_values():
    rents = parse_pipr_xlsx(FIXTURE.read_bytes())
    assert "E06000999" not in {r.area_code for r in rents}


def test_find_latest_pipr_url_picks_xlsx_anchor():
    html = '''
        <html><body>
        <a href="/file?uri=/.../priceindexofprivaterentsukmonthlypricestatistics10.xlsx" class="btn--primary">Download</a>
        <a href="/something/else.pdf">Methodology</a>
        </body></html>
    '''
    url = find_latest_pipr_url(html, base="https://www.ons.gov.uk")
    assert url == "https://www.ons.gov.uk/file?uri=/.../priceindexofprivaterentsukmonthlypricestatistics10.xlsx"
