import { describe, expect, it } from "vitest";
import { normalize, isValid } from "../src/postcode";

describe("normalize", () => {
  it("uppercases and removes whitespace", () => {
    expect(normalize("sw1a 1aa")).toBe("SW1A1AA");
  });
  it("handles outward-only postcodes", () => {
    expect(normalize("sw1a")).toBe("SW1A");
  });
  it("collapses multiple spaces", () => {
    expect(normalize("  sw1a   1aa  ")).toBe("SW1A1AA");
  });
});

describe("isValid", () => {
  it("accepts standard full postcodes", () => {
    expect(isValid("SW1A1AA")).toBe(true);
    expect(isValid("M11AE")).toBe(true);
    expect(isValid("EH12NG")).toBe(true);
  });
  it("accepts outward-only postcodes", () => {
    expect(isValid("SW1A")).toBe(true);
    expect(isValid("EH1")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValid("XYZ")).toBe(false);
    expect(isValid("12345")).toBe(false);
    expect(isValid("")).toBe(false);
  });
});
