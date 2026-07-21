/**
 * Folder-tree assembly — deliberately duplicated (not shared) from the
 * other generators, matching the "modules are islands" convention. Only
 * the tree builder is needed here; this module doesn't construct
 * `GeneratedFile`s of its own, it merges ones it's handed.
 */
import type { FolderNode } from '../../../shared/types/architecture.js';

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

export function buildFolderTree(files: readonly { path: string }[]): FolderNode[] {
  const root: MutableNode = { name: '', type: 'directory', children: new Map() };

  for (const item of files) {
    const segments = item.path.split('/');
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
