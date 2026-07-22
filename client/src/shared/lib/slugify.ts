/** "My Project!!" → "my-project", falling back to `fallback` when the input is all punctuation/whitespace. */
export function slugify(value: string, fallback: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}
