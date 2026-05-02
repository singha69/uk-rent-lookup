import { describe, expect, it } from "vitest";
import { lookupRent, type RentEntry } from "../src/lookup";

const TABLE: Record<string, RentEntry> = {
  E09000033: {
    area_name: "Westminster",
    area_level: "local_authority",
    monthly_rent_gbp: 2140,
    period: "2026-03",
    source: "ONS Price Index of Private Rents",
  },
  E12000007: {
    area_name: "London",
    area_level: "region",
    monthly_rent_gbp: 1850,
    period: "2026-03",
    source: "ONS Price Index of Private Rents",
  },
};

const REGIONS: Record<string, string> = {
  E09000033: "E12000007",
  E08000026: "E12000005",
};

describe("lookupRent", () => {
  it("returns local-authority match when present", () => {
    const r = lookupRent("E09000033", TABLE, REGIONS);
    expect(r).toEqual({
      area: "Westminster",
      area_level: "local_authority",
      monthly_rent_gbp: 2140,
      period: "2026-03",
      source: "ONS Price Index of Private Rents",
    });
  });

  it("returns null when LA missing and parent region also missing", () => {
    const r = lookupRent("E08000026", TABLE, REGIONS); // West Midlands not in TABLE
    expect(r).toBeNull();
  });

  it("auto-widens to region when LA missing but region is in table", () => {
    const tableWithoutLA: Record<string, RentEntry> = { E12000007: TABLE.E12000007 };
    const r = lookupRent("E09000033", tableWithoutLA, REGIONS);
    expect(r?.area).toBe("London");
    expect(r?.area_level).toBe("region");
    expect(r?.monthly_rent_gbp).toBe(1850);
  });

  it("returns null when neither LA nor region known", () => {
    expect(lookupRent("UNKNOWN", TABLE, REGIONS)).toBeNull();
  });

  it("falls back to country code for Scottish postcode when LA + region miss", () => {
    const tableWithCountry: Record<string, RentEntry> = {
      S92000003: {
        area_name: "Scotland",
        area_level: "country",
        monthly_rent_gbp: 850,
        period: "2026-03",
        source: "ONS Price Index of Private Rents",
      },
    };
    // S12000036 (Edinburgh) is not in the table, and regions.json doesn't include S codes.
    const r = lookupRent("S12000036", tableWithCountry, {});
    expect(r?.area).toBe("Scotland");
    expect(r?.area_level).toBe("country");
    expect(r?.monthly_rent_gbp).toBe(850);
  });

  it("falls back to country code for Welsh postcode", () => {
    const tableWithCountry: Record<string, RentEntry> = {
      W92000004: {
        area_name: "Wales",
        area_level: "country",
        monthly_rent_gbp: 780,
        period: "2026-03",
        source: "ONS Price Index of Private Rents",
      },
    };
    const r = lookupRent("W06000001", tableWithCountry, {});
    expect(r?.area).toBe("Wales");
  });

  it("returns null when even country code is missing from table", () => {
    expect(lookupRent("S12000036", {}, {})).toBeNull();
  });

  it("preserves LA precedence over country fallback", () => {
    const table: Record<string, RentEntry> = {
      S12000036: {
        area_name: "City of Edinburgh",
        area_level: "local_authority",
        monthly_rent_gbp: 1200,
        period: "2026-03",
        source: "ONS Price Index of Private Rents",
      },
      S92000003: {
        area_name: "Scotland",
        area_level: "country",
        monthly_rent_gbp: 850,
        period: "2026-03",
        source: "ONS Price Index of Private Rents",
      },
    };
    const r = lookupRent("S12000036", table, {});
    expect(r?.area).toBe("City of Edinburgh");
    expect(r?.area_level).toBe("local_authority");
  });
});
