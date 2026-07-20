/**
 * Emits Jest test scaffolds: one unit test per CRUD module (service layer,
 * mocking the repository), an integration test skeleton per module hitting
 * the real Express app with an in-memory Prisma mock, mock fixtures derived
 * from the real column types, and the Jest config itself.
 */
import { entitySingular } from './project-model.js';
import type { ModuleModel, ProjectModel } from './project-model.js';
import { mockValue } from './type-map.js';
import type { GeneratedFile } from '../backend-generator.types.js';
import { file } from './file-tree.js';

function unitTest(mod: ModuleModel): GeneratedFile | null {
  const entity = mod.entity;
  if (!entity) return null;
  const singular = entitySingular(entity.entity);

  const fields = entity.columns.filter(
    (c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name),
  );
  const fixtureFields = fields.map((c) => `  ${c.field}: ${mockValue(c)},`).join('\n');

  return file(
    `src/modules/${mod.name}/services/${mod.name}.service.test.ts`,
    'typescript',
    `import { ${singular}Service } from './${mod.name}.service.js';
import { ${singular}Repository } from '../repositories/${mod.name}.repository.js';

jest.mock('../repositories/${mod.name}.repository.js');

const fixture = {
  id: '00000000-0000-0000-0000-000000000001',
${fixtureFields}
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('${singular}Service', () => {
  let service: ${singular}Service;
  let repository: jest.Mocked<${singular}Repository>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ${singular}Service();
    repository = (${singular}Repository as jest.Mock).mock.instances[0] as jest.Mocked<${singular}Repository>;
  });

  it('lists records with pagination metadata', async () => {
    repository.findManyPaginated = jest.fn().mockResolvedValue([fixture]);
    repository.count = jest.fn().mockResolvedValue(1);

    const result = await service.list({});

    expect(result.items).toEqual([fixture]);
    expect(result.meta.total).toBe(1);
  });

  it('returns a record by id', async () => {
    repository.findById = jest.fn().mockResolvedValue(fixture);

    const result = await service.findById(fixture.id);

    expect(result).toEqual(fixture);
  });

  it('throws NotFoundError when the record is missing', async () => {
    repository.findById = jest.fn().mockResolvedValue(null);

    await expect(service.findById('missing-id')).rejects.toThrow('${entity.entity} not found');
  });

  it('creates a record', async () => {
    repository.create = jest.fn().mockResolvedValue(fixture);

    const result = await service.create(fixture);

    expect(repository.create).toHaveBeenCalled();
    expect(result).toEqual(fixture);
  });

  it('soft-deletes a record after confirming it exists', async () => {
    repository.findById = jest.fn().mockResolvedValue(fixture);
    repository.softDelete = jest.fn().mockResolvedValue(fixture);

    await service.remove(fixture.id);

    expect(repository.softDelete).toHaveBeenCalledWith(fixture.id);
  });
});
`,
  );
}

function integrationTest(mod: ModuleModel, apiPrefix: string): GeneratedFile | null {
  if (!mod.entity) return null;
  const listEndpoint = mod.endpoints.find((e) => e.kind === 'list');
  if (!listEndpoint) return null;

  return file(
    `test/integration/${mod.name}.integration.test.ts`,
    'typescript',
    `/**
 * Integration scaffold for ${mod.className}. Requires a running database
 * (point DATABASE_URL at a disposable test database before running).
 */
import request from 'supertest';

import { createApp } from '../../src/app.js';

describe('${apiPrefix}${mod.basePath} (integration)', () => {
  const app = createApp();

  it('GET ${apiPrefix}${mod.basePath} returns a paginated envelope', async () => {
    const response = await request(app).get('${apiPrefix}${mod.basePath}');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ success: true, data: expect.any(Array) }),
    );
  });
});
`,
  );
}

function jestConfig(): GeneratedFile {
  return file(
    'jest.config.js',
    'javascript',
    `/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\\\.{1,2}/.*)\\\\.js$': '$1' },
  transform: { '^.+\\\\.ts$': ['ts-jest', { useESM: true }] },
  testMatch: ['**/*.test.ts'],
};
`,
  );
}

function apiMocks(project: ProjectModel): GeneratedFile {
  const fixtures = project.modules
    .filter((m) => m.entity)
    .map((m) => {
      const entity = m.entity;
      if (!entity) return '';
      const fields = entity.columns
        .filter((c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name))
        .map((c) => `    ${c.field}: ${mockValue(c)},`)
        .join('\n');
      return `export const mock${entity.entity} = {
  id: '00000000-0000-0000-0000-000000000001',
${fields}
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};
`;
    })
    .join('\n');

  return file(
    'test/mocks/fixtures.ts',
    'typescript',
    `// Generated mock fixtures — one per entity, for unit and integration tests.\n\n${fixtures}`,
  );
}

export function emitTests(project: ProjectModel): GeneratedFile[] {
  const files: GeneratedFile[] = [jestConfig(), apiMocks(project)];
  for (const mod of project.modules) {
    const unit = unitTest(mod);
    if (unit) files.push(unit);
    const integration = integrationTest(mod, project.apiPrefix);
    if (integration) files.push(integration);
  }
  return files;
}
