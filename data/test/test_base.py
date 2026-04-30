from sources.base import AreaRent

def test_area_rent_constructs_with_required_fields():
    rent = AreaRent(
        area_code="E09000033",
        area_name="Westminster",
        area_level="local_authority",
        monthly_rent_gbp=2140,
        period="2026-03",
        source="ONS Price Index of Private Rents",
    )
    assert rent.area_code == "E09000033"
    assert rent.monthly_rent_gbp == 2140
