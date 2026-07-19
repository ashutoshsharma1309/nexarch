import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { downloadText } from '@/shared/lib/download';

export interface CodeViewerProps {
  code: string;
  /** Download file name, e.g. `schema.prisma`. */
  filename: string;
  mime: string;
  language: string;
}

/**
 * Monospace viewer for generated schema text (Prisma / SQL) with copy and
 * download. Deliberately unhighlighted — these are large files where fast,
 * scrollable, selectable plain text beats tokenized rendering.
 */
export function CodeViewer({ code, filename, mime, language }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-inset">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <p className="font-mono text-2xs text-fg-subtle">
          {filename} · {language}
        </p>
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
            onClick={() => {
              downloadText(filename, code, mime);
            }}
          >
            Download
          </Button>
        </div>
      </div>
      <pre className="max-h-[32rem] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-fg-muted">
        {code}
      </pre>
    </div>
  );
}
