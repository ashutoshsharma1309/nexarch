/**
 * Performance metrics. Token consumption and cache hit rate are real
 * numbers straight from the AI Orchestrator's own statistics when
 * provided. Bundle size and build/generation time are *estimates* derived
 * from generated source size — this module never runs a real build, so
 * every estimated metric is labeled `estimated: true` rather than
 * presented as a measurement. API latency has no value here unless the
 * client has actually made live requests; without that data it's honestly
 * omitted rather than invented.
 */
import type { PerformanceMetric, PerformanceReport, QualityArtifacts } from '../quality.types.js';

const BYTES_PER_KB = 1024;
/** Rough gzip ratio for minified JS/CSS text — used only to label an estimate, not claim precision. */
const ESTIMATED_COMPRESSION_RATIO = 0.3;
const LINES_PER_ESTIMATED_BUILD_SECOND = 400;

function totalSourceBytes(files: { content?: string }[]): number {
  return files.reduce((sum, file) => sum + (file.content?.length ?? 0), 0);
}

export function analyzePerformance(artifacts: QualityArtifacts): PerformanceReport {
  const backendFiles = artifacts.backend?.files ?? [];
  const frontendFiles = artifacts.frontend?.files ?? [];
  const totalFiles = backendFiles.length + frontendFiles.length;
  const totalLines = [...backendFiles, ...frontendFiles].reduce(
    (sum, f) => sum + (f.content?.split('\n').length ?? 0),
    0,
  );

  const frontendBytes = totalSourceBytes(frontendFiles);
  const bundleSizeEstimateKb = Math.round(
    (frontendBytes * ESTIMATED_COMPRESSION_RATIO) / BYTES_PER_KB,
  );
  const buildTimeEstimateSeconds = Math.max(
    1,
    Math.round(totalLines / LINES_PER_ESTIMATED_BUILD_SECOND),
  );

  const tokenConsumption = artifacts.aiStats
    ? {
        totalTokens: artifacts.aiStats.totalTokens,
        totalCostUsd: artifacts.aiStats.totalCostUsd,
        averageDurationMs: artifacts.aiStats.averageDurationMs,
      }
    : null;
  const cacheHitRate = artifacts.aiStats?.cache.hitRate ?? null;

  const metrics: PerformanceMetric[] = [
    { name: 'Total generated files', value: totalFiles, unit: 'files', estimated: false },
    { name: 'Total generated lines', value: totalLines, unit: 'lines', estimated: false },
    {
      name: 'Estimated frontend bundle size',
      value: bundleSizeEstimateKb,
      unit: 'KB (gzipped, estimated)',
      estimated: true,
    },
    {
      name: 'Estimated build time',
      value: buildTimeEstimateSeconds,
      unit: 'seconds (estimated)',
      estimated: true,
    },
  ];
  if (tokenConsumption) {
    metrics.push(
      {
        name: 'Total tokens consumed',
        value: tokenConsumption.totalTokens,
        unit: 'tokens',
        estimated: false,
      },
      {
        name: 'Total AI generation cost',
        value: Math.round(tokenConsumption.totalCostUsd * 10000) / 10000,
        unit: 'USD',
        estimated: false,
      },
      {
        name: 'Average generation latency',
        value: Math.round(tokenConsumption.averageDurationMs),
        unit: 'ms',
        estimated: false,
      },
    );
  }
  if (cacheHitRate !== null) {
    metrics.push({
      name: 'AI cache hit rate',
      value: Math.round(cacheHitRate * 1000) / 10,
      unit: '%',
      estimated: false,
    });
  }

  const recommendations: string[] = [];
  if (bundleSizeEstimateKb > 500)
    recommendations.push(
      'Frontend bundle is large — check for route-level code splitting on any page not already lazy-loaded.',
    );
  if (cacheHitRate !== null && cacheHitRate < 0.3)
    recommendations.push(
      'AI cache hit rate is low — repeated prompts with identical variables should be hitting cache more often.',
    );
  if (buildTimeEstimateSeconds > 60)
    recommendations.push(
      'Estimated build time is high for this project size — verify no unnecessary files are included in the build.',
    );
  if (recommendations.length === 0)
    recommendations.push(
      'No performance concerns detected at generation time — real numbers require a live build and traffic.',
    );

  let score = 100;
  if (bundleSizeEstimateKb > 500) score -= 15;
  if (bundleSizeEstimateKb > 1000) score -= 15;
  if (cacheHitRate !== null && cacheHitRate < 0.3) score -= 10;
  if (buildTimeEstimateSeconds > 60) score -= 10;
  score = Math.max(0, score);

  return {
    metrics,
    bundleSizeEstimateKb,
    buildTimeEstimateSeconds,
    tokenConsumption,
    cacheHitRate,
    recommendations,
    score,
  };
}
