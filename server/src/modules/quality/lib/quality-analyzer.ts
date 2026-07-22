/**
 * Static quality metrics computed directly from generated file content —
 * real numbers, not placeholders. Dead code and circular dependencies
 * reuse the Dependency Graph's own analysis (Phase 8) rather than
 * re-deriving it; duplication and complexity are computed here from raw
 * source text with lightweight, explainable heuristics (exact-content
 * hashing for duplication, decision-point counting for complexity) — real
 * static analysis (AST-based) is out of scope for a module that never
 * installs a parser.
 */
import { createHash } from 'node:crypto';

import type {
  IssueSeverity,
  LargeFile,
  QualityArtifacts,
  QualityIssue,
  QualityMetric,
  QualityReport,
} from '../quality.types.js';

const LARGE_FILE_LINE_THRESHOLD = 300;
const DECISION_POINT_PATTERN = /\b(if|else if|for|while|catch|case)\b|&&|\|\||\?\s*[^:]+:/g;

function allFiles(artifacts: QualityArtifacts): { path: string; content: string }[] {
  const backend = (artifacts.backend?.files ?? []).filter(
    (f): f is { path: string; content: string } => Boolean(f.content),
  );
  const frontend = (artifacts.frontend?.files ?? []).filter(
    (f): f is { path: string; content: string } => Boolean(f.content),
  );
  return [...backend, ...frontend];
}

function findDuplication(files: { path: string; content: string }[]): {
  duplication: QualityReport['duplication'];
  issues: QualityIssue[];
} {
  const byHash = new Map<string, string[]>();
  for (const file of files) {
    const normalized = file.content.replace(/\s+/g, ' ').trim();
    if (normalized.length < 40) continue; // trivial files (index re-exports) aren't meaningful duplicates
    const hash = createHash('sha256').update(normalized).digest('hex');
    const group = byHash.get(hash) ?? [];
    group.push(file.path);
    byHash.set(hash, group);
  }

  const duplicateGroups = Array.from(byHash.values()).filter((group) => group.length > 1);
  const issues: QualityIssue[] = duplicateGroups.map((group) => ({
    severity: 'low',
    category: 'duplication',
    location: group.join(', '),
    message: `${group.length} files are byte-for-byte identical`,
  }));

  return {
    duplication: {
      duplicateGroups: duplicateGroups.length,
      affectedFiles: duplicateGroups.reduce((sum, group) => sum + group.length, 0),
    },
    issues,
  };
}

function measureComplexity(files: { path: string; content: string }[]): {
  complexity: QualityReport['complexity'];
  issues: QualityIssue[];
} {
  let highestFile: string | null = null;
  let highestScore = 0;
  let total = 0;
  const issues: QualityIssue[] = [];

  for (const file of files) {
    const matches = file.content.match(DECISION_POINT_PATTERN);
    const score = matches?.length ?? 0;
    total += score;
    if (score > highestScore) {
      highestScore = score;
      highestFile = file.path;
    }
    if (score > 25) {
      issues.push({
        severity: score > 45 ? 'high' : 'medium',
        category: 'complexity',
        location: file.path,
        message: `${score} decision points — consider extracting smaller functions`,
      });
    }
  }

  return {
    complexity: {
      averageScore: files.length > 0 ? Math.round((total / files.length) * 10) / 10 : 0,
      highestFile,
      highestScore,
    },
    issues,
  };
}

function findLargeFiles(files: { path: string; content: string }[]): {
  largeFiles: LargeFile[];
  issues: QualityIssue[];
} {
  const largeFiles = files
    .map((file) => ({ path: file.path, lines: file.content.split('\n').length }))
    .filter((file) => file.lines > LARGE_FILE_LINE_THRESHOLD)
    .sort((a, b) => b.lines - a.lines);

  const issues: QualityIssue[] = largeFiles.map((file) => ({
    severity: file.lines > 600 ? 'high' : 'medium',
    category: 'large-file',
    location: file.path,
    message: `${file.lines} lines — above the ${LARGE_FILE_LINE_THRESHOLD}-line threshold`,
  }));

  return { largeFiles, issues };
}

export function analyzeQuality(artifacts: QualityArtifacts): QualityReport {
  const files = allFiles(artifacts);
  const { duplication, issues: duplicationIssues } = findDuplication(files);
  const { complexity, issues: complexityIssues } = measureComplexity(files);
  const { largeFiles, issues: largeFileIssues } = findLargeFiles(files);

  const deadCode = {
    unusedComponents: artifacts.dependencyGraph?.quality.unusedComponents ?? [],
    deadRoutes: artifacts.dependencyGraph?.quality.deadRoutes ?? [],
    orphanFiles: artifacts.dependencyGraph?.quality.orphanFiles ?? [],
  };
  const circularDependencies = artifacts.dependencyGraph?.stats.circularDependencyCount ?? 0;

  const deadCodeIssues: QualityIssue[] = [
    ...deadCode.unusedComponents.map((name): QualityIssue => ({
      severity: 'low',
      category: 'dead-code',
      location: name,
      message: 'Component appears unused by any page or route',
    })),
    ...deadCode.orphanFiles.map((path): QualityIssue => ({
      severity: 'low',
      category: 'dead-code',
      location: path,
      message: 'File has no incoming dependency edges',
    })),
  ];
  if (circularDependencies > 0) {
    deadCodeIssues.push({
      severity: 'high',
      category: 'circular-dependency',
      location: 'dependency graph',
      message: `${circularDependencies} circular dependency chain(s) detected`,
    });
  }

  const issues = [...duplicationIssues, ...complexityIssues, ...largeFileIssues, ...deadCodeIssues];

  const metrics: QualityMetric[] = [
    { name: 'Files analyzed', value: files.length, unit: 'files', status: 'good' },
    {
      name: 'Duplicate groups',
      value: duplication.duplicateGroups,
      unit: 'groups',
      status: duplication.duplicateGroups > 0 ? 'warning' : 'good',
    },
    {
      name: 'Average complexity',
      value: complexity.averageScore,
      unit: 'decision points/file',
      status: complexity.averageScore > 15 ? 'warning' : 'good',
    },
    {
      name: 'Large files',
      value: largeFiles.length,
      unit: 'files',
      status: largeFiles.length > 0 ? 'warning' : 'good',
    },
    {
      name: 'Circular dependencies',
      value: circularDependencies,
      unit: 'chains',
      status: circularDependencies > 0 ? 'critical' : 'good',
    },
    {
      name: 'Dead code candidates',
      value: deadCode.unusedComponents.length + deadCode.orphanFiles.length,
      unit: 'items',
      status: 'warning',
    },
  ];

  // Each severity's contribution is capped so one noisy category (e.g. a
  // long list of low-severity dead-code candidates on a large project)
  // can't single-handedly drag the score to zero — the cap keeps the
  // penalty proportionate to how *bad* the worst issues are, not just how
  // *many* minor ones exist.
  const cappedCount = (severity: IssueSeverity, cap: number): number =>
    Math.min(issues.filter((i) => i.severity === severity).length, cap);
  const penalty =
    cappedCount('critical', 5) * 15 +
    cappedCount('high', 8) * 6 +
    cappedCount('medium', 10) * 3 +
    cappedCount('low', 20) * 1;
  const score = Math.max(0, 100 - penalty);

  return {
    metrics,
    issues,
    duplication,
    complexity,
    deadCode,
    circularDependencies,
    largeFiles,
    score,
  };
}
