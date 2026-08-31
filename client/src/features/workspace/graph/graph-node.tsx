/**
 * One node on the canvas.
 *
 * Carries four signals at a glance: family (colour), exact type (mono
 * label), name, and relationship density (border weight). Selection and
 * dimming are the fifth and sixth, applied by the canvas.
 *
 * Kept deliberately plain — no shadows, no gradients, no animation. At a
 * hundred nodes any decoration becomes noise, and the thing being read is
 * the label.
 */
import { Handle, Position } from '@xyflow/react';
import { memo } from 'react';

import { cn } from '@/shared/lib/cn';
import type { EngNodeType } from '@/shared/types/api';
import { densityTier, FAMILY_CLASS, FAMILY_OF } from './node-style';

export interface GraphNodeData {
  label: string;
  nodeType: EngNodeType;
  degree: number;
  /** Set when a selection is active and this node is not part of it. */
  dimmed: boolean;
  selected: boolean;
  /** Reported by graph validation — this node has an open issue. */
  flagged: boolean;
  [key: string]: unknown;
}

function GraphNodeInner({ data }: { data: GraphNodeData }) {
  const family = FAMILY_OF[data.nodeType];
  const tier = densityTier(data.degree);

  return (
    <div
      className={cn(
        'flex w-[172px] items-center gap-2 rounded-md border px-2.5 py-1.5 transition-opacity',
        FAMILY_CLASS[family],
        tier === 2 && 'border-2',
        data.selected && 'ring-2 ring-ember ring-offset-1 ring-offset-canvas',
        data.flagged && !data.selected && 'border-dashed border-warning',
        // Dimming rather than hiding: context stays, focus shifts.
        data.dimmed && 'opacity-25',
      )}
      title={`${data.nodeType} · ${data.label} · ${String(data.degree)} relationships`}
    >
      <Handle type="target" position={Position.Top} className="!size-1 !border-0 !bg-line-strong" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.6875rem] leading-tight font-medium">{data.label}</p>
        <p className="mt-0.5 truncate font-mono text-[0.5625rem] leading-none text-fg-subtle">
          {data.nodeType}
          {data.degree > 0 && <span className="ml-1 opacity-70">·{data.degree}</span>}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1 !border-0 !bg-line-strong"
      />
    </div>
  );
}

/** Memoized: React Flow re-renders nodes on every viewport change otherwise. */
export const GraphNodeCard = memo(GraphNodeInner);
