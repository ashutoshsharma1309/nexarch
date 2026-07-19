import { KeyRound, MoveRight } from 'lucide-react';

import { Card, CardContent } from '@/shared/components/ui/card';
import type { EntityPlan } from '@/shared/types/api';

export function EntityGrid({ entities }: { entities: EntityPlan[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entities.map((entity) => (
        <Card key={entity.name}>
          <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
            <h3 className="text-[0.8125rem] font-medium text-fg">{entity.name}</h3>
            <code className="font-mono text-2xs text-fg-subtle">{entity.tableName}</code>
          </div>
          <CardContent className="space-y-2 px-4 py-3">
            <p className="flex items-center gap-1.5 font-mono text-2xs text-fg-muted">
              <KeyRound className="size-3 text-warning" />
              {entity.primaryKey}
              <span className="text-fg-subtle">· {entity.keyFields.length} key fields</span>
            </p>
            {entity.relations.length > 0 && (
              <ul className="space-y-1">
                {entity.relations.map((relation) => (
                  <li
                    key={relation.foreignKey + relation.target}
                    className="flex items-center gap-1.5 font-mono text-2xs text-fg-muted"
                  >
                    <MoveRight className="size-3 text-accent" />
                    {relation.target}
                    <span className="text-fg-subtle">({relation.foreignKey})</span>
                  </li>
                ))}
              </ul>
            )}
            {entity.indexes.length > 0 && (
              <p className="text-2xs text-fg-subtle">idx: {entity.indexes.join(', ')}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
