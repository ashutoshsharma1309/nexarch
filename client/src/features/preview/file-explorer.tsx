import { Check, ChevronRight, Copy, FileCode2, Folder, FolderOpen } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/cn';

export interface PreviewFile {
  path: string;
  content: string;
}

interface DirNode {
  name: string;
  children: Map<string, DirNode>;
  files: string[];
}

/** Flat `backend/src/app.ts` paths → a real tree, built once per file set. */
function buildTree(files: readonly PreviewFile[]): DirNode {
  const root: DirNode = { name: '', children: new Map(), files: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    const filename = segments.pop();
    if (!filename) continue;
    let node = root;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, children: new Map(), files: [] };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.files.push(file.path);
  }
  return root;
}

function Directory({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  // Open the top two levels so the explorer opens on real structure rather
  // than a single collapsed row the user has to go hunting through.
  const [open, setOpen] = useState(depth < 2);

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        className="flex w-full items-center gap-1 rounded-sm py-0.5 pr-2 text-left font-mono text-xs text-fg hover:bg-raised/60"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        {open ? (
          <FolderOpen className="size-3 shrink-0 text-accent" />
        ) : (
          <Folder className="size-3 shrink-0 text-accent" />
        )}
        <span className="truncate font-medium">{node.name}/</span>
      </button>

      {open && (
        <ul>
          {[...node.children.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <Directory
                key={child.name}
                node={child}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          {node.files.sort().map((path) => {
            const name = path.split('/').pop() ?? path;
            const active = selected === path;
            return (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(path);
                  }}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-sm py-0.5 pr-2 text-left font-mono text-xs transition-colors',
                    active
                      ? 'bg-accent-soft text-accent'
                      : 'text-fg-muted hover:bg-raised/60 hover:text-fg',
                  )}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 16}px` }}
                >
                  <FileCode2 className="size-3 shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * Two-pane project explorer: the real generated tree on the left, the real
 * file content on the right. Both come from the run's artifacts, so what is
 * shown here is byte-for-byte what the runner installed and started.
 */
export function FileExplorer({ files }: { files: readonly PreviewFile[] }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const [copied, setCopied] = useState(false);

  const current = files.find((file) => file.path === selected) ?? null;

  const copy = async (): Promise<void> => {
    if (!current) return;
    await navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <ul className="max-h-[36rem] overflow-auto rounded-lg border border-line bg-inset py-2">
        {[...tree.children.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => (
            <Directory
              key={child.name}
              node={child}
              depth={0}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
      </ul>

      <div className="overflow-hidden rounded-lg border border-line bg-inset">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
          <p className="truncate font-mono text-2xs text-fg-subtle">
            {current?.path ?? 'Select a file'}
          </p>
          {current && (
            <Button
              variant="ghost"
              size="sm"
              icon={
                copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />
              }
              onClick={() => {
                void copy();
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </div>
        <pre className="max-h-[33rem] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre text-fg-muted">
          {current?.content ?? ''}
        </pre>
      </div>
    </div>
  );
}
