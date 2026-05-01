export type AreaErrorCode =
  | "postcode_not_found"
  | "lookup_temporarily_unavailable";

export class AreaResolutionError extends Error {
  constructor(public readonly code: AreaErrorCode) {
    super(code);
  }
}

const POSTCODES_IO_TIMEOUT_MS = 3000;

export async function resolveArea(
  postcode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POSTCODES_IO_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      { signal: controller.signal },
    );
    if (resp.status === 404) {
      throw new AreaResolutionError("postcode_not_found");
    }
    if (!resp.ok) {
      throw new AreaResolutionError("lookup_temporarily_unavailable");
    }
    const body = (await resp.json()) as {
      result?: { codes?: { admin_district?: string } };
    };
    const code = body.result?.codes?.admin_district;
    if (!code) {
      throw new AreaResolutionError("postcode_not_found");
    }
    return code;
  } catch (e) {
    if (e instanceof AreaResolutionError) throw e;
    throw new AreaResolutionError("lookup_temporarily_unavailable");
  } finally {
    clearTimeout(timer);
  }
}
