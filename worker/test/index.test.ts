import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function stubFetch(impl: (input: RequestInfo | URL) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

describe("/lookup endpoint", () => {
  it("returns 400 invalid_postcode for garbage", async () => {
    const res = await worker.fetch(new Request("https://x/lookup?postcode=XYZ"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_postcode" });
  });

  it("returns 400 missing_postcode when omitted", async () => {
    const res = await worker.fetch(new Request("https://x/lookup"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown path", async () => {
    const res = await worker.fetch(new Request("https://x/other"));
    expect(res.status).toBe(404);
  });

  it("returns 503 when postcodes.io is down", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 503 })));
    const res = await worker.fetch(new Request("https://x/lookup?postcode=SW1A1AA"));
    expect(res.status).toBe(503);
    vi.restoreAllMocks();
  });

  it("returns 204 with CORS headers for OPTIONS preflight", async () => {
    const res = await worker.fetch(new Request("https://x/lookup", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
