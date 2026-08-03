import { timingSafeEqual } from "crypto"

/** Constant-time comparison for fixed-length administrative secrets. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8")
  const bufB = Buffer.from(b, "utf-8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
