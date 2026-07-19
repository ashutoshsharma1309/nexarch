/**
 * Optimization planner: index, caching, and partitioning recommendations
 * plus query guidelines. Every recommendation is conditional on the actual
 * design — reference tables become cache candidates, high-volume append
 * tables become partition candidates — so the advice is never boilerplate.
 */
import type {
  DatabaseDesign,
  IndexRecommendation,
  OptimizationReport,
  TableDesign,
} from '../database-designer.types.js';
import { CACHE_CANDIDATE_ENTITIES, PARTITION_CANDIDATE_ENTITIES } from './knowledge.js';

function indexRecommendations(tables: readonly TableDesign[]): IndexRecommendation[] {
  const recommendations: IndexRecommendation[] = [];
  for (const table of tables) {
    for (const index of table.indexes) {
      recommendations.push({
        table: table.tableName,
        columns: index.columns,
        kind: index.unique ? 'unique' : index.columns.length > 1 ? 'composite' : 'single',
        reason: index.rationale,
      });
    }
    // A status column that is filtered constantly benefits from a composite
    // with the soft-delete flag.
    const statusColumn = table.columns.find((c) => c.enumValues && c.name === 'status');
    if (statusColumn) {
      recommendations.push({
        table: table.tableName,
        columns: ['status', 'created_at'],
        kind: 'composite',
        reason: 'Dashboards filter by status and order by recency.',
      });
    }
  }
  return recommendations;
}

export function planOptimization(design: DatabaseDesign): OptimizationReport {
  const cachingCandidates = design.tables
    .filter((table) => CACHE_CANDIDATE_ENTITIES.has(table.entity))
    .map((table) => ({
      table: table.tableName,
      reason: 'Read-mostly reference data — cache with short TTL and invalidate on write.',
    }));

  const partitioningCandidates = design.tables
    .filter((table) => PARTITION_CANDIDATE_ENTITIES.has(table.entity))
    .map((table) => ({
      table: table.tableName,
      strategy: 'RANGE partition by created_at (monthly)',
      reason: 'High-volume append-mostly table; time-range partitioning keeps hot data compact.',
    }));

  const queryGuidelines = [
    'Always filter `deleted_at IS NULL` in default reads (covered by the deleted_at/created_at index).',
    'Paginate every list endpoint (keyset pagination on `created_at, id` beyond deep offsets).',
    'Select explicit columns; never `SELECT *` across text/JSON columns.',
    'Resolve N+1 access patterns with batched includes at the repository layer.',
  ];

  return {
    indexes: indexRecommendations(design.tables),
    cachingCandidates,
    partitioningCandidates,
    queryGuidelines,
  };
}
