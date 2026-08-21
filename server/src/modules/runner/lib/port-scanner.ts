/**
 * Free-port detection that can't be fooled by either stack. Binding alone
 * lies twice: Node sets SO_REUSEADDR, so on macOS a 127.0.0.1 bind
 * "succeeds" while another process holds the same port on the wildcard
 * address (this is exactly how a generated backend once landed on
 * NexArch's own 4000) — and an IPv4-only probe misses servers listening
 * only on ::1 (how a run collided with another project's Vite). Free
 * therefore means: nothing accepts a connection on either loopback, and
 * both loopbacks can be bound.
 */
import net from 'node:net';

const MAX_PROBES = 200;

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      // A machine without IPv6 can't conflict on IPv6 either.
      resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT');
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

function answersOn(port: number, host: string, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.unref();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function isFree(port: number): Promise<boolean> {
  // Connect checks first — they catch wildcard listeners that a
  // SO_REUSEADDR bind would sail straight past.
  if (await answersOn(port, '127.0.0.1')) return false;
  if (await answersOn(port, '::1')) return false;
  if (!(await canBind(port, '127.0.0.1'))) return false;
  if (!(await canBind(port, '::1'))) return false;
  return true;
}

export async function findFreePort(preferred: number): Promise<number> {
  for (let candidate = preferred; candidate < preferred + MAX_PROBES; candidate += 1) {
    if (await isFree(candidate)) return candidate;
  }
  throw new Error(
    `No free port found in ${String(preferred)}-${String(preferred + MAX_PROBES - 1)}`,
  );
}

/** True once something accepts on either loopback — dev servers bind ::1-only on some setups. */
export async function isPortAnswering(port: number, timeoutMs = 750): Promise<boolean> {
  if (await answersOn(port, '127.0.0.1', timeoutMs)) return true;
  return answersOn(port, '::1', timeoutMs);
}
