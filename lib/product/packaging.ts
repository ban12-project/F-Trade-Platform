/** Commercial packaging descriptions are compared ignoring case, whitespace and trailing punctuation.
 * Never apply this rule to OE, fitment or other engineering fields.
 */
export function canonicalPackaging(value: string): string {
  return value
    .trim()
    .replace(/[.|]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
