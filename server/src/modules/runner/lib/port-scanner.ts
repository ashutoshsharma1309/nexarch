/**
 * Free-port detection by actually binding — the only test that can't lie.
 * Preference-based: each process kind starts scanning from its own base so
 * backend/frontend land on recognizable, stable-ish ports across restarts
 * instead of whatever the OS hands out.
 */
import net from 'node:net';

const MAX_PROBES = 200;

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => {
      resolve(false);
    });
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

export async function findFreePort(preferred: number): Promise<number> {
  for (let candidate = preferred; candidate < preferred + MAX_PROBES; candidate += 1) {
    if (await probe(candidate)) return candidate;
  }
  throw new Error(
    `No free port found in ${String(preferred)}-${String(preferred + MAX_PROBES - 1)}`,
  );
}

/** True once something is accepting connections on the port — readiness signal. */
export function isPortAnswering(port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
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
