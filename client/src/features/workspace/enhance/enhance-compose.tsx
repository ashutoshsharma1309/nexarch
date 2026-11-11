/**
 * Step one: say what should change, and what to look at while changing it.
 *
 * What each option really does is written beside it. An image takes a
 * different path on the server from a plain request, and reference links are
 * opened only by web research; a form that implied otherwise would be
 * promising work nobody does.
 */
import { AlertTriangle, Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/shared/lib/cn';
import { ImageField } from '../tabs/edit/image-field';
import type { AttachedImage } from '../tabs/edit/image-field';
import {
  INSTRUCTION_MAX,
  INSTRUCTION_MIN,
  instructionWithLinks,
  parseReferenceLinks,
} from './enhance-model';
import type { ComposedEnhancement, ResearchMode } from './enhance-model';

const RESEARCH_OPTIONS: { value: ResearchMode; label: string; note: string }[] = [
  {
    value: 'auto',
    label: 'Automatic',
    note: 'The server searches only when the request depends on something outside this project, and says why either way.',
  },
  { value: 'on', label: 'Search the web', note: 'Runs a web search while planning.' },
  { value: 'off', label: 'Do not search', note: 'Plans from the project alone.' },
];

function ResearchChoice({
  value,
  disabled,
  onChange,
}: {
  value: ResearchMode;
  disabled: boolean;
  onChange: (mode: ResearchMode) => void;
}) {
  const selected = RESEARCH_OPTIONS.find((option) => option.value === value);
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-xs font-medium text-fg">Web research</legend>
      <div className="inline-flex flex-wrap rounded-md border border-line p-0.5">
        {RESEARCH_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'cursor-pointer rounded px-3 py-1 text-xs transition-colors',
              'has-focus-visible:outline-2 has-focus-visible:outline-accent',
              value === option.value ? 'bg-raised font-medium text-fg' : 'text-fg-muted',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name="enhance-research"
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-fg-muted">{selected?.note}</p>
    </fieldset>
  );
}

export function EnhanceCompose({
  planning,
  error,
  onSubmit,
}: {
  planning: boolean;
  /** The server's refusal, verbatim. Null when nothing has been refused. */
  error: string | null;
  onSubmit: (enhancement: ComposedEnhancement) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [links, setLinks] = useState('');
  const [research, setResearch] = useState<ResearchMode>('auto');
  const [image, setImage] = useState<AttachedImage | null>(null);
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [linksError, setLinksError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const request = instruction.trim();
    setInstructionError(null);
    setLinksError(null);
    if (request.length < INSTRUCTION_MIN) {
      setInstructionError(
        `Say what to change in at least ${String(INSTRUCTION_MIN)} characters, for example “add login and a protected dashboard”.`,
      );
      return;
    }
    // Links and research belong to the plain path; an image takes the other.
    const parsed = image === null ? parseReferenceLinks(links) : { ok: true as const, urls: [] };
    if (!parsed.ok) {
      setLinksError(parsed.error);
      return;
    }
    const total = instructionWithLinks(request, parsed.urls).length;
    if (total > INSTRUCTION_MAX) {
      setInstructionError(
        `With its links this request is ${String(total)} characters; the limit is ${String(INSTRUCTION_MAX)}.`,
      );
      return;
    }
    onSubmit({ instruction: request, referenceUrls: parsed.urls, research, image });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="enhance-instruction">What should change?</Label>
        <Textarea
          id="enhance-instruction"
          rows={4}
          maxLength={INSTRUCTION_MAX}
          placeholder="Add login and a protected dashboard, and keep the existing pages as they are."
          invalid={instructionError !== null}
          disabled={planning}
          value={instruction}
          onChange={(event) => {
            setInstruction(event.target.value);
          }}
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-xs text-danger">{instructionError}</p>
          <p className="font-mono text-2xs text-fg-subtle tabular-nums">
            {instruction.length}/{INSTRUCTION_MAX}
          </p>
        </div>
      </div>

      <ImageField image={image} disabled={planning} onChange={setImage} />

      {image !== null ? (
        <p className="rounded-md border border-line bg-inset px-3 py-2 text-xs leading-relaxed text-fg-muted">
          With an image attached, this runs as a design edit: the image is read and the site design
          changes to match. Reference links and web research do not apply on that path.
        </p>
      ) : (
        <>
          <div>
            <Label htmlFor="enhance-links">Reference links (optional, one per line)</Label>
            <Textarea
              id="enhance-links"
              rows={2}
              placeholder="https://example.com/pricing"
              invalid={linksError !== null}
              disabled={planning}
              value={links}
              onChange={(event) => {
                setLinks(event.target.value);
              }}
            />
            {linksError !== null ? (
              <p className="mt-1 text-xs text-danger">{linksError}</p>
            ) : (
              <p className="mt-1 text-xs text-fg-muted">
                Web research opens these and measures their layout, unless you choose Do not search,
                when they are only passed along as text. The plan lists what was read.
              </p>
            )}
          </div>
          <ResearchChoice value={research} disabled={planning} onChange={setResearch} />
        </>
      )}

      {error !== null && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {planning
            ? 'Reading the project and writing a plan.'
            : 'Nothing changes yet. Small changes start right after planning; anything substantial waits for your approval.'}
        </p>
        <Button
          type="submit"
          variant="forge"
          loading={planning}
          icon={<Wand2 className="size-3.5" />}
        >
          {planning ? 'Planning…' : 'Plan this change'}
        </Button>
      </div>
    </form>
  );
}
