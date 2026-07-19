import { Download } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { downloadText } from '@/shared/lib/download';
import type { DesignBundle } from '@/shared/types/api';

/** One click per generated artifact — the seven Phase 4 deliverables. */
export function ExportBar({ bundle, slug }: { bundle: DesignBundle; slug: string }) {
  const json = (value: unknown): string => JSON.stringify(value, null, 2);

  const artifacts: { label: string; filename: string; content: string; mime: string }[] = [
    {
      label: 'schema.prisma',
      filename: 'schema.prisma',
      content: bundle.prismaSchema,
      mime: 'text/plain',
    },
    {
      label: 'schema.sql',
      filename: 'schema.sql',
      content: bundle.sqlSchema,
      mime: 'application/sql',
    },
    {
      label: 'openapi.json',
      filename: 'openapi.json',
      content: json(bundle.openapi),
      mime: 'application/json',
    },
    {
      label: 'database-design.json',
      filename: `${slug}-database-design.json`,
      content: json(bundle.databaseDesign),
      mime: 'application/json',
    },
    {
      label: 'er-diagram.json',
      filename: 'er-diagram.json',
      content: json(bundle.erDiagram),
      mime: 'application/json',
    },
    {
      label: 'validation-rules.json',
      filename: 'validation-rules.json',
      content: json(bundle.validationRules),
      mime: 'application/json',
    },
    {
      label: 'entity-metadata.json',
      filename: 'entity-metadata.json',
      content: json(bundle.entityMetadata),
      mime: 'application/json',
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {artifacts.map((artifact) => (
        <Button
          key={artifact.filename}
          size="sm"
          icon={<Download className="size-3.5" />}
          onClick={() => {
            downloadText(artifact.filename, artifact.content, artifact.mime);
          }}
        >
          {artifact.label}
        </Button>
      ))}
    </div>
  );
}
