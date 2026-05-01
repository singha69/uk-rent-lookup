import { normalize, isValid } from "./postcode";
import { resolveArea, AreaResolutionError } from "./area";
import { lookupRent, type RentEntry } from "./lookup";

import rentsJson from "../data/rents.json";
import regionsJson from "../data/regions.json";

// wrangler.toml declares `[[rules]] type = "Text"` for JSON, so these imports
// arrive as strings at deploy time. Vitest's native ESM JSON import resolves
// them to objects. Parse strings; pass through objects.
function asTable<T>(input: unknown): Record<string, T> {
  return typeof input === "string"
    ? (JSON.parse(input) as Record<string, T>)
    : (input as Record<string, T>);
}
const RENTS = asTable<RentEntry>(rentsJson);
const REGIONS = asTable<string>(regionsJson);

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
