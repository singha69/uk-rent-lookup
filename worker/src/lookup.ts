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

const COUNTRY_BY_PREFIX: Record<string, string> = {
  E: "E92000001",
  W: "W92000004",
  S: "S92000003",
  N: "N92000002",
};

function entryToResult(entry: RentEntry): RentResult {
  return {
    area: entry.area_name,
    area_level: entry.area_level,
    monthly_rent_gbp: entry.monthly_rent_gbp,
    period: entry.period,
    source: entry.source,
  };
}

function countryCodeFor(areaCode: string): string | null {
  const prefix = areaCode[0];
  return COUNTRY_BY_PREFIX[prefix] ?? null;
}

export function lookupRent(
  areaCode: string,
  table: Record<string, RentEntry>,
  regions: Record<string, string>,
): RentResult | null {
  const direct = table[areaCode];
  if (direct) return entryToResult(direct);

  const parent = regions[areaCode];
  if (parent && table[parent]) return entryToResult(table[parent]);

  const country = countryCodeFor(areaCode);
  if (country && table[country]) return entryToResult(table[country]);

  return null;
}
