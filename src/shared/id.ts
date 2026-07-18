/** Short unique id (works in both Node and the browser). */
export function newId(length = 10): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length)
}
