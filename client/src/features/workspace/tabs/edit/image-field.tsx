/**
 * Attaching an image to an edit.
 *
 * The file is read and measured here, in the browser, before anything is
 * sent: the panel shows the thumbnail, the name, the real byte count and the
 * real pixel size, so what the server is about to be asked to read is on
 * screen first. A 4 MB file is refused here too, because sending five and a
 * half megabytes of base64 to be told no is a slow way to learn it.
 *
 * Only the two limits the browser can state accurately are checked here —
 * the type and the size. The edge-length rules stay on the server rather
 * than being copied, because two copies of a limit is two limits, and the
 * second one drifts.
 */
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { cn } from '@/shared/lib/cn';
import { formatBytes } from '@/shared/lib/format';
import type { ImageKind } from '@/shared/types/api';

export interface AttachedImage {
  dataUrl: string;
  kind: ImageKind;
  name: string;
  bytes: number;
  width: number;
  height: number;
}

const ACCEPT = 'image/png,image/jpeg,image/webp';
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Decoded bytes, matching the server: base64 is a third larger than this. */
const MAX_BYTES = 4 * 1024 * 1024;

const KINDS: { kind: ImageKind; label: string }[] = [
  { kind: 'reference', label: 'Reference screenshot' },
  { kind: 'mockup', label: 'Design mockup' },
  { kind: 'asset', label: 'App asset' },
];

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`“${file.name}” could not be encoded for upload.`));
    };
    reader.onerror = () => {
      reject(new Error(`“${file.name}” could not be read from disk.`));
    };
    reader.readAsDataURL(file);
  });
}

/** Pixel dimensions, from the browser's own decoder rather than the header. */
function measure(dataUrl: string, name: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => {
      resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => {
      reject(new Error(`“${name}” is not an image this browser can decode. Try re-exporting it.`));
    };
    probe.src = dataUrl;
  });
}

async function readAttachment(file: File, kind: ImageKind): Promise<AttachedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(
      `“${file.name}” is ${file.type === '' ? 'of an unknown type' : file.type}, not a PNG, JPEG or WebP image. Those three are what the vision model accepts.`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `The image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB. Export it smaller or screenshot a region.`,
    );
  }
  const dataUrl = await toDataUrl(file);
  const { width, height } = await measure(dataUrl, file.name);
  return { dataUrl, kind, name: file.name, bytes: file.size, width, height };
}

export function ImageField({
  image,
  disabled,
  onChange,
}: {
  image: AttachedImage | null;
  disabled: boolean;
  onChange: (image: AttachedImage | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const kindName = useId();

  const accept = (file: File | undefined): void => {
    if (!file) return;
    setError(null);
    setReading(true);
    void readAttachment(file, image?.kind ?? 'reference')
      .then((attached) => {
        onChange(attached);
      })
      .catch((cause: unknown) => {
        onChange(null);
        setError(cause instanceof Error ? cause.message : 'That file could not be attached.');
      })
      .finally(() => {
        setReading(false);
      });
  };

  return (
    <div>
      <Label htmlFor="edit-image">Attach an image (optional)</Label>

      <input
        ref={inputRef}
        id="edit-image"
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          accept(event.target.files?.[0]);
          // Clearing it means picking the same file again still fires.
          event.target.value = '';
        }}
      />

      {image ? (
        <div className="rounded-md border border-line bg-inset p-3">
          <div className="flex items-start gap-3">
            {/* The thumbnail is the attachment's receipt: it is the one thing
                that proves the right file was picked. */}
            <img
              src={image.dataUrl}
              alt={`Attached image: ${image.name}`}
              className="size-16 shrink-0 rounded border border-line object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-fg">{image.name}</p>
              <p className="mt-0.5 font-mono text-2xs text-fg-subtle tabular-nums">
                {formatBytes(image.bytes)} · {image.width}×{image.height}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  loading={reading}
                  icon={<Upload className="size-3" />}
                  onClick={() => {
                    inputRef.current?.click();
                  }}
                >
                  Replace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  icon={<X className="size-3" />}
                  onClick={() => {
                    setError(null);
                    onChange(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>

          <fieldset className="mt-3 border-t border-line pt-3" disabled={disabled}>
            <legend className="sr-only">What is this image?</legend>
            <div className="flex flex-wrap items-center gap-3">
              {KINDS.map((option) => (
                <label
                  key={option.kind}
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    image.kind === option.kind ? 'text-fg' : 'text-fg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name={kindName}
                    value={option.kind}
                    checked={image.kind === option.kind}
                    onChange={() => {
                      onChange({ ...image, kind: option.kind });
                    }}
                    className="accent-accent"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-fg-subtle">
              A reference screenshot and a design mockup are read for style only — nothing from them
              is copied into the project. An app asset is a file meant to appear in the app itself.
            </p>
          </fieldset>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => {
            setOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            accept(event.dataTransfer.files[0]);
          }}
          className={cn(
            'rounded-md border border-dashed border-line bg-inset/40 px-4 py-5 text-center transition-colors',
            over && 'border-accent bg-accent-soft/30',
            disabled && 'opacity-50',
          )}
        >
          <ImageIcon className="mx-auto size-4 text-fg-subtle" />
          <p className="mt-2 text-xs text-fg-muted">
            Drop a PNG, JPEG or WebP here, or{' '}
            <button
              type="button"
              disabled={disabled || reading}
              onClick={() => {
                inputRef.current?.click();
              }}
              className="text-accent underline underline-offset-2 hover:text-accent-hover disabled:opacity-50"
            >
              choose a file
            </button>
            .
          </p>
          <p className="mt-1 font-mono text-2xs text-fg-subtle">up to 4 MB · 64–8000 px a side</p>
          {reading && <p className="mt-1 text-2xs text-fg-subtle">Reading the file…</p>}
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
