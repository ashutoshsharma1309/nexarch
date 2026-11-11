/** Stored URLs came from the open web, so they are checked again before becoming links. */
/** The URL only if it is plain http(s) with no embedded credentials. */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
