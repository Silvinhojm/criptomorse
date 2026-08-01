import { timingSafeEqual } from "crypto"

/** Constant-time string comparison — avoids leaking secret length/content via
 *  response-time differences. Buffers of different length are NOT compared
 *  with timingSafeEqual (it throws), so we short-circuit that case first;
 *  this leaks length, which is acceptable (secrets here are fixed-length env
 *  values, not something an attacker controls the length of). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8")
  const bufB = Buffer.from(b, "utf-8")
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
