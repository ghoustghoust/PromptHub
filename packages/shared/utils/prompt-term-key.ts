/**
 * One canonical spelling for vocabulary terms.
 *
 * Imported libraries disagree on underscores, escaped parentheses and spacing
 * (`blender \(medium\)` vs `blender (medium)` vs `Blender_(Medium)`). Curated
 * collections reference terms by text, so both sides normalize through this
 * helper before comparing.
 */
export function resolveTermKey(term: string): string {
  return term
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
}