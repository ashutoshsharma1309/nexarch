/**
 * The one place HTTP happens. A thin typed wrapper over the GitHub REST
 * API that maps GitHub's failure modes onto the platform's AppError
 * vocabulary once, so services read like intent (`await gh(...)`) and
 * controllers never see a raw fetch error. 30s timeout because tree/blob
 * creation on large pushes is legitimately slower than a health check.
 */
import { AppError } from '../../../shared/utils/app-error.js';

const API_BASE = 'https://api.github.com';
const TIMEOUT_MS = 30_000;

export type GithubMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface GithubErrorBody {
  message?: string;
}

function mapError(status: number, message: string): AppError {
  if (status === 401) return AppError.unauthorized(`GitHub rejected the token: ${message}`);
  if (status === 403 && /rate limit/i.test(message)) {
    return AppError.rateLimited(`GitHub API rate limit reached: ${message}`);
  }
  if (status === 403) return AppError.forbidden(`GitHub denied the request: ${message}`);
  if (status === 404) return AppError.notFound(`GitHub resource not found: ${message}`);
  if (status === 409 || status === 422) {
    return AppError.conflict(`GitHub rejected the request: ${message}`);
  }
  return AppError.internal(`GitHub API error (${String(status)}): ${message}`);
}

export async function githubRequest<T>(
  token: string,
  method: GithubMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw AppError.internal('GitHub API is unreachable', error);
  }

  if (!response.ok) {
    let message = response.statusText;
    try {
      const parsed = (await response.json()) as GithubErrorBody;
      if (parsed.message) message = parsed.message;
    } catch {
      // Non-JSON error body — the status text is the best we have.
    }
    throw mapError(response.status, message);
  }

  // 204 responses (ref deletion etc.) have no body to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
