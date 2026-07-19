import { Check, Copy, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/shared/components/ui/button';

/**
 * Dependency-free JSON syntax highlighting: the serialized document is
 * tokenized with a single pass and rendered as colored spans using the
 * design system's semantic palette (keys → accent, strings → foreground,
 * numbers → ember, punctuation → subtle).
 */
const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlight(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of json.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    if (index > cursor) {
      nodes.push(
        <span key={key++} className="text-fg-subtle">
          {json.slice(cursor, index)}
        </span>,
      );
    }

    const [, stringToken, colonAfter, keywordToken, numberToken] = match;
    if (stringToken !== undefined) {
      nodes.push(
        <span key={key++} className={colonAfter ? 'text-accent' : 'text-fg'}>
          {stringToken}
        </span>,
      );
      if (colonAfter) {
        nodes.push(
          <span key={key++} className="text-fg-subtle">
            {colonAfter}
          </span>,
        );
      }
    } else if (keywordToken !== undefined) {
      nodes.push(
        <span key={key++} className="text-warning">
          {keywordToken}
        </span>,
      );
    } else if (numberToken !== undefined) {
      nodes.push(
        <span key={key++} className="text-ember">
          {numberToken}
        </span>,
      );
    }
    cursor = index + match[0].length;
  }

  if (cursor < json.length) {
    nodes.push(
      <span key={key++} className="text-fg-subtle">
        {json.slice(cursor)}
      </span>,
    );
  }
  return nodes;
}

export interface JsonViewerProps {
  value: unknown;
  /** Basename for the exported file, without extension. */
  exportName: string;
}

export function JsonViewer({ value, exportName }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const highlighted = useMemo(() => highlight(json), [json]);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const exportFile = (): void => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${exportName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-inset">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <p className="font-mono text-2xs text-fg-subtle">{exportName}.json</p>
        <div className="flex gap-1">
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
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="size-3.5" />}
            onClick={exportFile}
          >
            Export
          </Button>
        </div>
      </div>
      <pre className="max-h-[28rem] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {highlighted}
      </pre>
    </div>
  );
}
