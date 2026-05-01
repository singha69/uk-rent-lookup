import { describe, expect, it, vi } from "vitest";
import { resolveArea, AreaResolutionError } from "../src/area";

const ok = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
const err = (status: number) => Promise.resolve(new Response("", { status }));

describe("resolveArea", () => {
  it("returns admin_district code on success", async () => {
    const fetchMock = vi.fn().mockReturnValue(
      ok({ status: 200, result: { codes: { admin_district: "E09000033" } } })
    );
    const code = await resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch);
    expect(code).toBe("E09000033");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.postcodes.io/postcodes/SW1A1AA",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("throws postcode_not_found on 404", async () => {
    const fetchMock = vi.fn().mockReturnValue(err(404));
    await expect(resolveArea("ZZ99ZZ", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("postcode_not_found"));
  });

  it("throws lookup_temporarily_unavailable on 5xx", async () => {
    const fetchMock = vi.fn().mockReturnValue(err(503));
    await expect(resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("lookup_temporarily_unavailable"));
  });

  it("throws lookup_temporarily_unavailable on network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("lookup_temporarily_unavailable"));
  });

  it("throws postcode_not_found when admin_district is missing from response", async () => {
    const fetchMock = vi.fn().mockReturnValue(
      ok({ status: 200, result: { codes: {} } })
    );
    await expect(resolveArea("SW1A1AA", fetchMock as unknown as typeof fetch))
      .rejects.toThrow(new AreaResolutionError("postcode_not_found"));
  });
});
