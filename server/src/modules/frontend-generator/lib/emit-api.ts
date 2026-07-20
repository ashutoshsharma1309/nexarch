/**
 * Emits the API integration layer: shared envelope types (matching the
 * generated backend's exact `{ success, message, data, meta }` / error
 * shape from Phase 5 verbatim — this is not guessed, it is the real
 * contract), the Axios client with auth + error-normalizing interceptors,
 * the TanStack Query client, and per-entity services + query/mutation
 * hooks. Only entities the backend-manifest marks as implemented get a
 * service — wiring hooks against a route Phase 5 never built would be
 * worse than not generating it.
 */
import { entitySingular } from './project-model.js';
import type { PageModel } from './project-model.js';
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const apiTypes = `export interface ApiMeta {
  requestId?: string;
  pagination?: PageMeta;
  [key: string]: unknown;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta: ApiMeta;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  message: string;
  data: null;
  meta: ApiMeta;
  error: {
    code: ApiErrorCode;
    details?: ApiErrorDetail[];
  };
}
`;

const apiClient = `import axios, { AxiosError } from 'axios';

import { useAuthStore } from '@/shared/store/auth.store';
import type { ApiErrorCode, ApiFailure, ApiSuccess } from '@/shared/types/api';

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;
  readonly details: ApiFailure['error']['details'];

  constructor(code: ApiErrorCode, message: string, status?: number, details?: ApiFailure['error']['details']) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isApiFailure(value: unknown): value is ApiFailure {
  return typeof value === 'object' && value !== null && 'success' in value && value.success === false;
}

export const apiClient = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (error instanceof AxiosError) {
      const body: unknown = error.response?.data;
      if (isApiFailure(body)) {
        throw new ApiClientError(body.error.code, body.message, error.response?.status, body.error.details);
      }
      throw new ApiClientError('NETWORK_ERROR', 'The API is unreachable', error.response?.status);
    }
    throw error instanceof Error ? error : new Error(String(error));
  },
);

export function unwrap<T>(body: ApiSuccess<T>): T {
  return body.data;
}
`;

const queryClient = `import { QueryClient } from '@tanstack/react-query';

import { ApiClientError } from './api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError && error.status !== undefined && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
`;

const authService = `import { apiClient, unwrap } from '@/shared/services/api-client';
import type { ApiSuccess } from '@/shared/types/api';
import type { AuthUser } from '@/shared/store/auth.store';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export async function login(payload: LoginPayload): Promise<AuthResult> {
  const response = await apiClient.post<ApiSuccess<AuthResult>>('/auth/login', payload);
  return unwrap(response.data);
}

export async function register(payload: RegisterPayload): Promise<AuthResult> {
  const response = await apiClient.post<ApiSuccess<AuthResult>>('/auth/register', payload);
  return unwrap(response.data);
}
`;

const useAuthHooks = `import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { toast } from '@/shared/store/toast.store';
import { useAuthStore } from '@/shared/store/auth.store';
import { login, register } from '../services/auth.service';
import type { LoginPayload, RegisterPayload } from '../services/auth.service';

export function useLogin() {
  const setSession = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (payload: LoginPayload) => login(payload),
    onSuccess: (result) => {
      setSession(result.token, result.user);
      toast('Signed in', 'success');
      void navigate('/');
    },
    onError: (error: Error) => {
      toast(error.message, 'error');
    },
  });
}

export function useRegister() {
  const setSession = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (payload: RegisterPayload) => register(payload),
    onSuccess: (result) => {
      setSession(result.token, result.user);
      toast('Account created', 'success');
      void navigate('/');
    },
    onError: (error: Error) => {
      toast(error.message, 'error');
    },
  });
}
`;

function entityService(page: PageModel): string {
  const singular = entitySingular(page.name);
  return `import { apiClient, unwrap } from '@/shared/services/api-client';
import type { ApiMeta, ApiSuccess } from '@/shared/types/api';
import type { Create${singular}Input, Update${singular}Input, ${page.name}Record } from '../types';

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

export interface ListResult {
  items: ${page.name}Record[];
  meta: ApiMeta;
}

const BASE_PATH = '${page.apiBasePath}';

export async function list${page.name}(query: ListQuery = {}): Promise<ListResult> {
  const response = await apiClient.get<ApiSuccess<${page.name}Record[]>>(BASE_PATH, { params: query });
  return { items: response.data.data, meta: response.data.meta };
}

export async function get${singular}(id: string): Promise<${page.name}Record> {
  const response = await apiClient.get<ApiSuccess<${page.name}Record>>(\`\${BASE_PATH}/\${id}\`);
  return unwrap(response.data);
}

export async function create${singular}(payload: Create${singular}Input): Promise<${page.name}Record> {
  const response = await apiClient.post<ApiSuccess<${page.name}Record>>(BASE_PATH, payload);
  return unwrap(response.data);
}

export async function update${singular}(id: string, payload: Update${singular}Input): Promise<${page.name}Record> {
  const response = await apiClient.put<ApiSuccess<${page.name}Record>>(\`\${BASE_PATH}/\${id}\`, payload);
  return unwrap(response.data);
}

export async function delete${singular}(id: string): Promise<void> {
  await apiClient.delete(\`\${BASE_PATH}/\${id}\`);
}
`;
}

function entityHooks(page: PageModel): string {
  const singular = entitySingular(page.name);
  const slug = page.slug;
  return `import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/shared/store/toast.store';
import {
  create${singular},
  delete${singular},
  get${singular},
  list${page.name},
  update${singular},
} from '../services/${slug}.service';
import type { ListQuery } from '../services/${slug}.service';
import type { Create${singular}Input, Update${singular}Input } from '../types';

const queryKeys = {
  all: ['${slug}'] as const,
  list: (query: ListQuery) => ['${slug}', 'list', query] as const,
  detail: (id: string) => ['${slug}', 'detail', id] as const,
};

export function use${page.name}List(query: ListQuery = {}) {
  return useQuery({
    queryKey: queryKeys.list(query),
    queryFn: () => list${page.name}(query),
  });
}

export function use${singular}(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.detail(id ?? ''),
    queryFn: () => get${singular}(id as string),
    enabled: Boolean(id),
  });
}

export function useCreate${singular}() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Create${singular}Input) => create${singular}(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.all });
      toast('${singular} created', 'success');
    },
    onError: (error: Error) => {
      toast(error.message, 'error');
    },
  });
}

export function useUpdate${singular}() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Update${singular}Input }) => update${singular}(id, payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.all });
      toast('${singular} updated', 'success');
    },
    onError: (error: Error) => {
      toast(error.message, 'error');
    },
  });
}

export function useDelete${singular}() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => delete${singular}(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.all });
      toast('${singular} deleted', 'success');
    },
    onError: (error: Error) => {
      toast(error.message, 'error');
    },
  });
}
`;
}

export function emitApiLayer(pages: PageModel[], authEnabled: boolean): GeneratedFile[] {
  const files: GeneratedFile[] = [
    file('src/shared/types/api.ts', 'typescript', apiTypes),
    file('src/shared/services/api-client.ts', 'typescript', apiClient),
    file('src/shared/services/query-client.ts', 'typescript', queryClient),
  ];

  if (authEnabled) {
    files.push(
      file('src/features/auth/services/auth.service.ts', 'typescript', authService),
      file('src/features/auth/hooks/use-auth.ts', 'typescript', useAuthHooks),
    );
  }

  for (const page of pages.filter((p) => p.implemented)) {
    files.push(
      file(
        `src/features/${page.slug}/services/${page.slug}.service.ts`,
        'typescript',
        entityService(page),
      ),
      file(`src/features/${page.slug}/hooks/use-${page.slug}.ts`, 'typescript', entityHooks(page)),
    );
  }

  return files;
}
