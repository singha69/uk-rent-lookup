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

function entryToResult(entry: RentEntry): RentResult {
  return {
    area: entry.area_name,
    area_level: entry.area_level,
    monthly_rent_gbp: entry.monthly_rent_gbp,
    period: entry.period,
    source: entry.source,
  };
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
  return null;
}
