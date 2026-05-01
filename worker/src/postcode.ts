const FULL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const OUTWARD_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

export function normalize(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function isValid(normalized: string): boolean {
  return FULL_POSTCODE_RE.test(normalized) || OUTWARD_RE.test(normalized);
}
