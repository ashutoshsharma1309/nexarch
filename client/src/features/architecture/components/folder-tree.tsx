import { FileCode2, Folder } from 'lucide-react';

import type { FolderNode } from '@/shared/types/api';

function TreeNode({ node, depth }: { node: FolderNode; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-1.5 py-0.5 font-mono text-xs"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {node.type === 'directory' ? (
          <Folder className="size-3 shrink-0 text-accent" />
        ) : (
          <FileCode2 className="size-3 shrink-0 text-fg-subtle" />
        )}
        <span className={node.type === 'directory' ? 'text-fg' : 'text-fg-muted'}>
          {node.name}
          {node.type === 'directory' ? '/' : ''}
        </span>
      </div>
      {node.children && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.name} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Recursive, read-only render of the planned project tree. */
export function FolderTree({ nodes }: { nodes: FolderNode[] }) {
  return (
    <ul className="max-h-[30rem] overflow-auto rounded-lg border border-line bg-inset px-4 py-3">
      {nodes.map((node) => (
        <TreeNode key={node.name} node={node} depth={0} />
      ))}
    </ul>
  );
}
