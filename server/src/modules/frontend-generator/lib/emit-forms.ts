/**
 * Emits, per entity page: the TS record/input types, the Zod validation
 * schemas (derived from the same ColumnDesign the Backend Generator used —
 * frontend and backend validation can never drift because both read the
 * same database-design.json), and a React Hook Form component that renders
 * the right input for each column's inferred type.
 */
import { entitySingular } from './project-model.js';
import type { PageModel } from './project-model.js';
import { inputTypeOf, labelOf, tsType, zodField } from './type-map.js';
import type { FieldInputType, GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

function typesFile(page: PageModel): string {
  const entity = page.entity;
  if (!entity) return '';
  const singular = entitySingular(page.name);
  const recordFields = entity.columns.map((c) => `  ${c.field}: ${tsType(c)};`).join('\n');
  const inputFields = page.formFields
    .map((c) => {
      const hasDefault = Boolean(c.defaultExpression) || c.enumValues !== undefined;
      const optional = c.nullable || hasDefault ? '?' : '';
      return `  ${c.field}${optional}: ${tsType(c)};`;
    })
    .join('\n');
  const updateFields = page.formFields.map((c) => `  ${c.field}?: ${tsType(c)};`).join('\n');

  // An interface with only a comment body is structurally `{}`, which
  // accepts any non-nullish value — Record<string, never> says "no fields"
  // without tripping @typescript-eslint/no-empty-object-type.
  const createInput = inputFields
    ? `export interface Create${singular}Input {\n${inputFields}\n}`
    : `export type Create${singular}Input = Record<string, never>;`;
  const updateInput = updateFields
    ? `export interface Update${singular}Input {\n${updateFields}\n}`
    : `export type Update${singular}Input = Record<string, never>;`;

  return `/** ${page.name} entity, mirroring the backend's response shape. */
export interface ${page.name}Record {
${recordFields}
}

${createInput}

${updateInput}
`;
}

function schemaFile(page: PageModel): string {
  const singular = entitySingular(page.name);
  const createLines = page.formFields.map((c) => `  ${c.field}: ${zodField(c, false)},`).join('\n');
  const updateLines = page.formFields.map((c) => `  ${c.field}: ${zodField(c, true)},`).join('\n');

  return `import { z } from 'zod';

export const create${singular}Schema = z.object({
${createLines || '  /* no client-supplied fields */'}
});

export const update${singular}Schema = z.object({
${updateLines || '  /* no client-supplied fields */'}
});

export type Create${singular}FormValues = z.infer<typeof create${singular}Schema>;
export type Update${singular}FormValues = z.infer<typeof update${singular}Schema>;
`;
}

function renderField(column: PageModel['formFields'][number]): string {
  const kind = inputTypeOf(column);
  const label = labelOf(column);
  const errorExpr = `errors.${column.field}?.message`;

  if (kind === 'checkbox') {
    return `      <div className="flex items-center gap-2">
        <input
          id="${column.field}"
          type="checkbox"
          {...register('${column.field}')}
          className="size-4 rounded border-line accent-accent"
        />
        <Label htmlFor="${column.field}" className="mb-0">${label}</Label>
      </div>`;
  }

  if (kind === 'select' && column.enumValues) {
    const options = column.enumValues
      .map((v) => `          <option value="${v}">${v}</option>`)
      .join('\n');
    return `      <div>
        <Label htmlFor="${column.field}">${label}</Label>
        <Select id="${column.field}" invalid={Boolean(${errorExpr})} {...register('${column.field}')}>
${options}
        </Select>
        {${errorExpr} && <p className="mt-1 text-xs text-danger">{${errorExpr}}</p>}
      </div>`;
  }

  if (kind === 'textarea') {
    return `      <div>
        <Label htmlFor="${column.field}">${label}</Label>
        <Textarea id="${column.field}" rows={3} invalid={Boolean(${errorExpr})} {...register('${column.field}')} />
        {${errorExpr} && <p className="mt-1 text-xs text-danger">{${errorExpr}}</p>}
      </div>`;
  }

  const htmlType = kind === 'number' ? 'number' : kind;
  return `      <div>
        <Label htmlFor="${column.field}">${label}</Label>
        <Input
          id="${column.field}"
          type="${htmlType}"
          invalid={Boolean(${errorExpr})}
          {...register('${column.field}'${kind === 'number' ? ', { valueAsNumber: true }' : ''})}
        />
        {${errorExpr} && <p className="mt-1 text-xs text-danger">{${errorExpr}}</p>}
      </div>`;
}

/** An entity with zero client-supplied fields (e.g. every column is
 * server-managed or a bare FK) gets a minimal confirm-style form — no
 * register/errors/initialValues to wire up when there is nothing to bind. */
function emptyFormComponent(page: PageModel): string {
  const singular = entitySingular(page.name);
  return `import { Button } from '@/shared/components/ui/button';
import type { Create${singular}FormValues } from '../schema';

export interface ${singular}FormProps {
  // Accepted for interface parity with every other generated form (the
  // page always passes it), but there is nothing to prefill here.
  initialValues?: Partial<Create${singular}FormValues>;
  onSubmit: (values: Create${singular}FormValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function ${singular}Form({ onSubmit, onCancel, submitting = false }: ${singular}FormProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-muted">This record has no fields to configure.</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={submitting}
          onClick={() => {
            onSubmit({});
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
`;
}

function formComponent(page: PageModel): string {
  if (page.formFields.length === 0) return emptyFormComponent(page);

  const singular = entitySingular(page.name);
  const fieldsMarkup = page.formFields.map((c) => renderField(c)).join('\n');
  const defaultEntries = page.formFields
    .map(
      (c) =>
        `    ${c.field}: initialValues?.${c.field} ?? ${c.enumValues ? `'${c.enumValues[0] ?? ''}'` : c.prismaType === 'Boolean' ? 'false' : c.prismaType === 'Int' || c.prismaType === 'Decimal' ? '0' : `''`},`,
    )
    .join('\n');

  // Each input primitive is only imported when a field actually renders it —
  // an entity with no enum field must not import the unused Select, etc.
  const kinds = new Set(page.formFields.map((c) => inputTypeOf(c)));
  const needsLabel = page.formFields.length > 0;
  const inputBackedKinds: FieldInputType[] = [
    'text',
    'number',
    'email',
    'password',
    'date',
    'datetime-local',
  ];
  const needsInput = inputBackedKinds.some((k) => kinds.has(k));
  const needsSelect = kinds.has('select');
  const needsTextarea = kinds.has('textarea');

  const imports = [
    "import { zodResolver } from '@hookform/resolvers/zod';",
    "import { useForm } from 'react-hook-form';",
    '',
    "import { Button } from '@/shared/components/ui/button';",
    needsInput ? "import { Input } from '@/shared/components/ui/input';" : null,
    needsLabel ? "import { Label } from '@/shared/components/ui/label';" : null,
    needsSelect ? "import { Select } from '@/shared/components/ui/select';" : null,
    needsTextarea ? "import { Textarea } from '@/shared/components/ui/textarea';" : null,
    `import { create${singular}Schema } from '../schema';`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return `${imports}
import type { Create${singular}FormValues } from '../schema';

export interface ${singular}FormProps {
  initialValues?: Partial<Create${singular}FormValues>;
  onSubmit: (values: Create${singular}FormValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function ${singular}Form({ initialValues, onSubmit, onCancel, submitting = false }: ${singular}FormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Create${singular}FormValues>({
    resolver: zodResolver(create${singular}Schema),
    defaultValues: {
${defaultEntries}
    },
  });

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      noValidate
      className="space-y-4"
    >
${fieldsMarkup}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={submitting}>
          Save
        </Button>
      </div>
    </form>
  );
}
`;
}

export function emitForms(pages: PageModel[]): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const page of pages.filter((p) => p.implemented)) {
    files.push(
      file(`src/features/${page.slug}/types.ts`, 'typescript', typesFile(page)),
      file(`src/features/${page.slug}/schema.ts`, 'typescript', schemaFile(page)),
      file(
        `src/features/${page.slug}/components/${entitySingular(page.name)}Form.tsx`,
        'typescriptreact',
        formComponent(page),
      ),
    );
  }
  return files;
}
