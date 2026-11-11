/**
 * The limits on no-auth mode.
 *
 * With `AUTH_DISABLED=true` every request is an authorized ADMIN and no token
 * is checked, which is only tolerable on a developer's own machine. Production
 * refuses the setting outright, and everywhere else the mode answers loopback
 * peers only.
 */

/** Why this configuration must not start, or null when it may. */
export function noAuthRefusal(mode: { disabled: boolean; isProduction: boolean }): string | null {
  if (!mode.disabled || !mode.isProduction) return null;
  return 'Fatal: AUTH_DISABLED=true is refused when NODE_ENV=production, because it makes every request an unauthenticated admin. Set AUTH_DISABLED=false and a JWT_SECRET of at least 32 characters.\n';
}

/**
 * Whether a TCP peer is this machine.
 *
 * The socket address and never `X-Forwarded-For`: a header is whatever the
 * caller chose to send, and it is the caller being checked.
 */
export function isLoopbackPeer(address: string | undefined): boolean {
  if (address === undefined) return false;
  const peer = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return peer === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(peer);
}

/** Whether a Host header names this machine. Absent names nothing. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const value = host.trim().toLowerCase();
  const name = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.split(':')[0];
  return (
    name === 'localhost' || name === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name ?? '')
  );
}

/**
 * The address to listen on: loopback in no-auth mode, and undefined (Node's
 * default, every interface) when real authentication is on, since a
 * container's published port never reaches a loopback-only listener.
 */
export function safeListenHost(authDisabled: boolean): string | undefined {
  return authDisabled ? '127.0.0.1' : undefined;
}
