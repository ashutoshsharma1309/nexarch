/**
 * Step one of an edit: say what to change, and optionally show an image.
 *
 * The limits are the server's, stated here so the form can answer before a
 * round trip. When the server refuses anyway — a damaged header, an edge
 * length, a file that lied about its type — its message is rendered as it
 * was written rather than replaced with a shorter one of ours: those
 * sentences name the real limit and the thing to try next.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { ImageField } from './image-field';
import type { AttachedImage } from './image-field';

/** The server's own bounds, so the form refuses what the API would refuse. */
const INSTRUCTION_MIN = 8;
const INSTRUCTION_MAX = 2_000;

const composeSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(
      INSTRUCTION_MIN,
      'Say what to change in at least 8 characters — “make the hero warmer and put the menu first” is enough.',
    )
    .max(INSTRUCTION_MAX, `That instruction is longer than ${INSTRUCTION_MAX} characters.`),
});
type ComposeValues = z.infer<typeof composeSchema>;

export interface ComposedEdit {
  instruction: string;
  image: AttachedImage | null;
}

export function EditCompose({
  planning,
  error,
  onSubmit,
}: {
  planning: boolean;
  /** The server's refusal, verbatim. Null when nothing has been refused. */
  error: string | null;
  onSubmit: (edit: ComposedEdit) => void;
}) {
  const [image, setImage] = useState<AttachedImage | null>(null);
  const form = useForm<ComposeValues>({
    resolver: zodResolver(composeSchema),
    defaultValues: { instruction: '' },
  });
  const instruction = form.watch('instruction');

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          onSubmit({ instruction: values.instruction, image });
        })(event);
      }}
      noValidate
      className="space-y-4"
    >
      <div>
        <Label htmlFor="edit-instruction">What should change?</Label>
        <Textarea
          id="edit-instruction"
          rows={3}
          maxLength={INSTRUCTION_MAX}
          placeholder="Make the hero warmer, move the menu above the gallery, and use the orange from the screenshot."
          invalid={Boolean(form.formState.errors.instruction)}
          disabled={planning}
          {...form.register('instruction')}
        />
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-xs text-danger">{form.formState.errors.instruction?.message}</p>
          <p className="font-mono text-2xs text-fg-subtle tabular-nums">
            {instruction.length}/{INSTRUCTION_MAX}
          </p>
        </div>
      </div>

      <ImageField image={image} disabled={planning} onChange={setImage} />

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
            ? 'Reading the attachment and proposing a design — a few seconds.'
            : 'This writes a plan first. Nothing changes until you apply it.'}
        </p>
        <Button type="submit" loading={planning} icon={<Wand2 className="size-3.5" />}>
          {planning ? 'Planning…' : 'Plan this edit'}
        </Button>
      </div>
    </form>
  );
}
