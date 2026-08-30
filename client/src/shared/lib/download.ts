/** Trigger a client-side file download for generated content. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Client-side file helpers for project export/import (Steps 19–20).
 *
 * The package never touches the network beyond the API call that produced
 * it: export builds a Blob in the browser and clicks a temporary link;
 * import reads a File the user picked and parses it locally before it is
 * sent back. Nothing is uploaded to a third party, and the object URL is
 * revoked as soon as the click is dispatched.
 */

/** Turns a value into a downloaded JSON file with a filesystem-safe name. */
export function downloadJson(value: unknown, baseName: string): void {
  const safe = baseName
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safe || 'project'}.nexarch.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Reads a picked file and parses it as JSON, rejecting on malformed input. */
export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON');
  }
}
