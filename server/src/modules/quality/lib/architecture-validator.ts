/**
 * Architecture validation — checks the generated project's actual file
 * paths against the conventions the Architecture Planner (Phase 3) and
 * generators (Phases 5/6) are supposed to follow: feature-first structure,
 * consistent casing, layer separation (controller/service/repository each
 * in their own file), and single-responsibility file naming.
 */
import type {
  ArchitectureCheck,
  ArchitectureValidationReport,
  QualityArtifacts,
} from '../quality.types.js';

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fileBaseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function checkNamingConsistency(paths: string[]): ArchitectureCheck {
  const tsFiles = paths.filter((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
  const violations = tsFiles.filter((p) => {
    const base = fileBaseName(p).replace(/\.(ts|tsx)$/, '');
    // Component/page files are PascalCase by convention; everything else kebab-case.
    const isComponentLike = /^[A-Z]/.test(base);
    return isComponentLike ? false : !KEBAB_CASE.test(base.replace(/\./g, '-'));
  });

  return {
    name: 'Consistent file naming',
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? 'All files follow kebab-case (or PascalCase for components)'
        : `${violations.length} file(s) break naming convention: ${violations.slice(0, 3).join(', ')}`,
  };
}

function checkLayerSeparation(backendPaths: string[]): ArchitectureCheck {
  const modules = new Set(
    backendPaths
      .filter((p) => p.includes('/modules/'))
      .map((p) => p.split('/modules/')[1]?.split('/')[0])
      .filter((m): m is string => Boolean(m)),
  );

  const missingLayers: string[] = [];
  for (const moduleName of modules) {
    const modulePaths = backendPaths.filter((p) => p.includes(`/modules/${moduleName}/`));
    const hasController = modulePaths.some((p) => p.endsWith('.controller.ts'));
    const hasService = modulePaths.some((p) => p.endsWith('.service.ts'));
    if (!hasController || !hasService) missingLayers.push(moduleName);
  }

  return {
    name: 'Controller/service layer separation',
    passed: missingLayers.length === 0,
    detail:
      missingLayers.length === 0
        ? `All ${modules.size} module(s) separate controller from service`
        : `Missing controller or service in: ${missingLayers.join(', ')}`,
  };
}

function checkFeatureIsolation(frontendPaths: string[]): ArchitectureCheck {
  const featureImportsSharedOnly = frontendPaths.filter(
    (p) => p.includes('/features/') && (p.endsWith('.ts') || p.endsWith('.tsx')),
  );
  // Heuristic: features/ existing at all signals feature-first structure (the
  // generators always emit it); a real cross-feature-import scan would need
  // an import parser, which this module doesn't carry.
  return {
    name: 'Feature-first folder structure',
    passed: featureImportsSharedOnly.length > 0 || frontendPaths.length === 0,
    detail:
      featureImportsSharedOnly.length > 0
        ? `${new Set(featureImportsSharedOnly.map((p) => p.split('/features/')[1]?.split('/')[0])).size} feature folder(s) found`
        : 'No features/ folder found',
  };
}

function checkSingleResponsibility(paths: string[]): ArchitectureCheck {
  // A file whose name doesn't signal a single concern (e.g. "utils.ts",
  // "helpers.ts", "misc.ts") is the cheapest available SOLID smell to flag
  // without parsing the file for actual responsibilities.
  const vagueNames = paths.filter((p) =>
    /\b(utils?|helpers?|misc|common)\.tsx?$/i.test(fileBaseName(p)),
  );
  return {
    name: 'No vague catch-all utility files',
    passed: vagueNames.length === 0,
    detail:
      vagueNames.length === 0
        ? 'No generic utils/helpers/misc files found'
        : `${vagueNames.length} vaguely-named file(s): ${vagueNames.slice(0, 3).join(', ')}`,
  };
}

function checkFolderStructureDepth(artifacts: QualityArtifacts): ArchitectureCheck {
  const folderStructure = artifacts.architecture?.folderStructure ?? [];
  return {
    name: 'Architecture plan defines a folder structure',
    passed: folderStructure.length > 0,
    detail:
      folderStructure.length > 0
        ? `${folderStructure.length} top-level entries planned`
        : 'No folder structure in the architecture plan',
  };
}

export function validateArchitecture(artifacts: QualityArtifacts): ArchitectureValidationReport {
  const backendPaths = (artifacts.backend?.files ?? []).map((f) => f.path);
  const frontendPaths = (artifacts.frontend?.files ?? []).map((f) => f.path);
  const allPaths = [...backendPaths, ...frontendPaths];

  const checks: ArchitectureCheck[] = [
    checkFolderStructureDepth(artifacts),
    checkNamingConsistency(allPaths),
    checkLayerSeparation(backendPaths),
    checkFeatureIsolation(frontendPaths),
    checkSingleResponsibility(allPaths),
  ];

  const violations = checks.filter((c) => !c.passed).map((c) => c.detail);
  const score = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);

  return { checks, violations, score };
}
