/**
 * File assembly helpers: a typed constructor for generated files, a folder
 * tree builder that turns flat paths into the nested structure the Frontend
 * Explorer renders, and a line counter for the stats.
 */
import type { FolderNode } from '../../../shared/types/architecture.js';
import type { FileLanguage, GeneratedFile } from '../frontend-generator.types.js';

export function file(path: string, language: FileLanguage, content: string): GeneratedFile {
  return { path, language, content: `${content.replace(/\s+$/, '')}\n` };
}

export function countLines(files: readonly GeneratedFile[]): number {
  return files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
}

interface MutableNode {
  name: string;
  type: 'directory' | 'file';
  children: Map<string, MutableNode>;
}

function freeze(node: MutableNode): FolderNode {
  if (node.type === 'file') return { name: node.name, type: 'file' };
  const children = [...node.children.values()]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map(freeze);
  return { name: node.name, type: 'directory', children };
}

export function buildFolderTree(files: readonly GeneratedFile[]): FolderNode[] {
  const root: MutableNode = { name: '', type: 'directory', children: new Map() };

  for (const generated of files) {
    const segments = generated.path.split('/');
    let cursor = root;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      let next = cursor.children.get(segment);
      if (!next) {
        next = { name: segment, type: isFile ? 'file' : 'directory', children: new Map() };
        cursor.children.set(segment, next);
      }
      cursor = next;
    });
  }

  return freeze(root).children ?? [];
}
