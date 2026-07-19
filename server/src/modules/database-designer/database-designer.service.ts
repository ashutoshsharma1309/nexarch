/**
 * Database Designer service: orchestrates the engines into one DesignBundle.
 *
 *   entities → tables + enums (table-designer)
 *            → relationships (relationship-engine)
 *            → optimization (optimization-planner)
 *   design   → prisma, sql, ER, validation, metadata (generators)
 *   design + architecture → OpenAPI 3.1 (openapi-generator)
 *   bundle   → integrity report (schema-validator)
 *
 * Pure and deterministic apart from the generated-at timestamp, so the same
 * inputs always yield the same artifacts.
 */
import { logger } from '../../shared/logger/index.js';
import type { ArchitecturePlan } from '../../shared/types/architecture.js';
import type { RequirementSpec } from '../../shared/types/requirement.js';
import type { DatabaseDesign, DesignBundle, PrismaEnumDesign } from './database-designer.types.js';
import { generateEntityMetadata } from './lib/entity-metadata-generator.js';
import { generateErDiagram } from './lib/er-diagram-generator.js';
import { generateOpenApi } from './lib/openapi-generator.js';
import { planOptimization } from './lib/optimization-planner.js';
import { generatePrismaSchema } from './lib/prisma-generator.js';
import { buildRelationships } from './lib/relationship-engine.js';
import { validateDesign } from './lib/schema-validator.js';
import { generateSqlSchema } from './lib/sql-generator.js';
import { designTable } from './lib/table-designer.js';
import { generateValidationRules } from './lib/validation-generator.js';

function dedupeEnums(enums: readonly PrismaEnumDesign[]): PrismaEnumDesign[] {
  const byName = new Map<string, PrismaEnumDesign>();
  for (const enumDef of enums) {
    if (!byName.has(enumDef.name)) byName.set(enumDef.name, enumDef);
  }
  return [...byName.values()];
}

export function designDatabase(
  architecture: ArchitecturePlan,
  requirements: RequirementSpec,
): DesignBundle {
  const startedAt = performance.now();
  const generatedAt = new Date().toISOString();

  const entities = architecture.database.entities;
  const roleEnumValues = requirements.roles.map((role) =>
    role
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
  );
  const tables = [];
  const allEnums: PrismaEnumDesign[] = [];
  for (const entity of entities) {
    const { table, enums } = designTable(entity, { roleEnumValues });
    tables.push(table);
    allEnums.push(...enums);
  }

  const design: DatabaseDesign = {
    meta: {
      projectName: architecture.meta.projectName,
      projectType: architecture.meta.projectType,
      engine: architecture.database.engine || 'MySQL 8',
      databaseVersion: 'MySQL 8.0',
      normalForm: 'Third Normal Form (3NF)',
      generatedAt,
      generator: 'nexarch-database-designer/1.0',
    },
    enums: dedupeEnums(allEnums),
    tables,
    relationships: buildRelationships(entities),
    optimization: {
      indexes: [],
      cachingCandidates: [],
      partitioningCandidates: [],
      queryGuidelines: [],
    },
  };
  design.optimization = planOptimization(design);

  const openapi = generateOpenApi(architecture, design);

  const bundle: DesignBundle = {
    databaseDesign: design,
    prismaSchema: generatePrismaSchema(design),
    sqlSchema: generateSqlSchema(design),
    erDiagram: generateErDiagram(design),
    openapi,
    validationRules: generateValidationRules(design),
    entityMetadata: generateEntityMetadata(design, requirements),
    integrity: validateDesign(design, openapi),
  };

  logger.info('database design produced', {
    projectType: design.meta.projectType,
    tables: bundle.integrity.stats.tables,
    relationships: bundle.integrity.stats.relationships,
    endpoints: bundle.integrity.stats.endpoints,
    valid: bundle.integrity.valid,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return bundle;
}
