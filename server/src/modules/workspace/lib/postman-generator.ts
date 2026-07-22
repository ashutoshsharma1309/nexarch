/**
 * OpenAPI 3.1 → Postman Collection v2.1 transformer. Real structural
 * conversion (folders per path, one request per operation, `{{baseUrl}}`
 * variable, bearer-auth wiring from `security`) — not a pass-through.
 */
import type { OpenApiDocument, OpenApiOperation } from '../../../shared/types/design.js';

interface PostmanRequest {
  name: string;
  request: {
    method: string;
    header: { key: string; value: string }[];
    url: { raw: string; host: string[]; path: string[] };
    auth?: { type: 'bearer'; bearer: { key: string; value: string }[] };
    body?: { mode: 'raw'; raw: string; options: { raw: { language: 'json' } } };
  };
}

interface PostmanFolder {
  name: string;
  item: PostmanRequest[];
}

function toPostmanRequest(path: string, method: string, op: OpenApiOperation): PostmanRequest {
  const segments = path.split('/').filter(Boolean);
  const request: PostmanRequest['request'] = {
    method: method.toUpperCase(),
    header: [{ key: 'Content-Type', value: 'application/json' }],
    url: { raw: `{{baseUrl}}${path}`, host: ['{{baseUrl}}'], path: segments },
  };

  if (op.security?.length) {
    request.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{authToken}}' }] };
  }

  if (op.requestBody) {
    const schema = op.requestBody.content['application/json']?.schema;
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(schema ? exampleFromSchema(schema) : {}, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  return { name: op.summary || `${method.toUpperCase()} ${path}`, request };
}

function exampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as { type?: string; properties?: Record<string, unknown>; example?: unknown };
  if (s.example !== undefined) return s.example;
  if (s.type === 'object' && s.properties) {
    return Object.fromEntries(
      Object.entries(s.properties).map(([key, value]) => [key, exampleFromSchema(value)]),
    );
  }
  if (s.type === 'string') return '';
  if (s.type === 'number' || s.type === 'integer') return 0;
  if (s.type === 'boolean') return false;
  return null;
}

export function openApiToPostmanCollection(openapi: OpenApiDocument): Record<string, unknown> {
  const folders = new Map<string, PostmanFolder>();

  for (const [path, item] of Object.entries(openapi.paths)) {
    const tag = path.split('/').find(Boolean) ?? 'root';
    if (!folders.has(tag)) folders.set(tag, { name: tag, item: [] });
    const folder = folders.get(tag);
    if (!folder) continue;
    for (const [method, op] of Object.entries(item)) {
      folder.item.push(toPostmanRequest(path, method, op));
    }
  }

  return {
    info: {
      name: openapi.info.title,
      description: openapi.info.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: openapi.servers[0]?.url ?? 'http://localhost:4000/api/v1' },
      { key: 'authToken', value: '' },
    ],
    item: Array.from(folders.values()),
  };
}
