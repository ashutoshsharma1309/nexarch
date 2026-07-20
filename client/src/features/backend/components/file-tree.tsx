import { FileCode2, Folder, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/shared/lib/cn';
import type { GeneratedFolderNode } from '@/shared/types/api';

interface TreeNodeProps {
  node: GeneratedFolderNode;
  path: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeNode({ node, path, depth, selectedPath, onSelect }: TreeNodeProps) {
  const fullPath = path ? `${path}/${node.name}` : node.name;
  // Directories start open down to depth 2 (src/, src/modules/, src/shared/)
  // so a fresh explorer already shows real structure, not a wall of collapsed rows.
  const [open, setOpen] = useState(depth < 2);

  if (node.type === 'file') {
    const active = selectedPath === fullPath;
    return (
      <li>
        <button
          type="button"
          onClick={() => {
            onSelect(fullPath);
          }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-sm py-0.5 pr-2 text-left font-mono text-xs transition-colors',
            active
              ? 'bg-accent-soft text-accent'
              : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
          )}
          style={{ paddingLeft: `${depth * 14 + 20}px` }}
        >
          <FileCode2 className="size-3 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        className="flex w-full items-center gap-1.5 rounded-sm py-0.5 pr-2 text-left font-mono text-xs text-fg hover:bg-raised/60"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {open ? (
          <FolderOpen className="size-3 shrink-0 text-accent" />
        ) : (
          <Folder className="size-3 shrink-0 text-accent" />
        )}
        <span className="truncate font-medium">{node.name}/</span>
      </button>
      {open && node.children && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.name}
              node={child}
              path={fullPath}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface FileTreeProps {
  nodes: GeneratedFolderNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

/** Interactive project tree: click a file to open it in the code viewer. */
export function FileTree({ nodes, selectedPath, onSelect }: FileTreeProps) {
  return (
    <ul className="max-h-[34rem] overflow-auto rounded-lg border border-line bg-inset px-2 py-2">
      {nodes.map((node) => (
        <TreeNode
          key={node.name}
          node={node}
          path=""
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
