/** One above the highest number already used. */
export function nextIds(prefix: string, width: number, existing: readonly string[], count: number): string[] {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  let highest = 0
  for (const id of existing) {
    const match = pattern.exec(id)
    const digits = match?.[1]
    if (digits !== undefined) highest = Math.max(highest, Number(digits))
  }
  const ids: string[] = []
  for (let step = 1; step <= count; step++) {
    ids.push(`${prefix}-${String(highest + step).padStart(width, '0')}`)
  }
  return ids
}
