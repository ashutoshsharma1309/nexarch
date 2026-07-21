/**
 * Merges a freshly (re-)generated project with the previous one, touching
 * only what the impact analysis marked as affected. Manual edits always
 * win — a file the caller lists as hand-modified is never overwritten by
 * either the old or the newly generated content, which is the one
 * invariant "preserve developer modifications" actually requires.
 */
import type {
  FileProvenance,
  MergedFile,
  MergeStats,
  ProjectFile,
} from '../dependency-graph.types.js';

export interface MergeInputs {
  oldFiles: ProjectFile[];
  newFiles: ProjectFile[];
  affectedPaths: ReadonlySet<string>;
  manualEdits?: Record<string, string> | undefined;
}

export function mergeProject(inputs: MergeInputs): { files: MergedFile[]; stats: MergeStats } {
  const { oldFiles, newFiles, affectedPaths, manualEdits = {} } = inputs;
  const oldByPath = new Map(oldFiles.map((f) => [f.path, f]));
  const newByPath = new Map(newFiles.map((f) => [f.path, f]));
  const allPaths = new Set([...oldByPath.keys(), ...newByPath.keys()]);

  const files: MergedFile[] = [];
  const stats: MergeStats = { regenerated: 0, preserved: 0, manual: 0, total: 0 };

  for (const path of allPaths) {
    const manualContent = manualEdits[path];
    const oldFile = oldByPath.get(path);
    const newFile = newByPath.get(path);

    let content: string;
    let language: string;
    let provenance: FileProvenance;

    if (manualContent !== undefined) {
      content = manualContent;
      language = newFile?.language ?? oldFile?.language ?? 'typescript';
      provenance = 'manual';
    } else if (affectedPaths.has(path) && newFile) {
      content = newFile.content;
      language = newFile.language;
      provenance = 'regenerated';
    } else if (oldFile) {
      content = oldFile.content;
      language = oldFile.language;
      provenance = 'preserved';
    } else if (newFile) {
      // A brand-new file the change introduced, outside the pre-computed affected set.
      content = newFile.content;
      language = newFile.language;
      provenance = 'regenerated';
    } else {
      continue;
    }

    files.push({ path, content, language, provenance });
    stats[provenance] += 1;
    stats.total += 1;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, stats };
}
