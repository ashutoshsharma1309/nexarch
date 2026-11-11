/**
 * Why two nodes are connected, in the words of the artifact that said so.
 *
 * The graph is deterministic: every edge was derived by code from something
 * a generated artifact states — the specifier of an import, the column a
 * foreign key is on, the reason the architecture gave for one service using
 * another. The builder has been recording that on `edge.metadata` all along
 * and the UI never rendered any of it, so a relationship reached the reader
 * as a bare arrow with a verb on it: `DEPENDS_ON`, trust us.
 *
 * Known keys are phrased; anything else is shown as `key: value` rather than
 * dropped, because an edge the builder starts annotating differently is
 * still evidence and silently losing it is how this drifted in the first
 * place. An edge whose metadata is empty returns null, and the caller says
 * so plainly — "no evidence recorded" is a weaker claim than a stated
 * reason, and the difference is the point.
 */

/** Metadata values are arbitrary JSON; only render what reads as a value. */
function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function edgeEvidence(metadata: Record<string, unknown> | undefined): string | null {
  if (metadata === undefined) return null;

  // An import is the strongest evidence the graph holds: the specifier is
  // the line of source that produced the edge.
  const specifier = scalar(metadata.specifier);
  if (specifier !== null) return `imports ${specifier}`;

  const foreignKey = scalar(metadata.foreignKey);
  if (foreignKey !== null) {
    const onDelete = scalar(metadata.onDelete);
    return onDelete === null
      ? `foreign key ${foreignKey}`
      : `foreign key ${foreignKey}, on delete ${onDelete}`;
  }

  const reason = scalar(metadata.reason);
  if (reason !== null) return reason;

  const side = scalar(metadata.side);
  if (side !== null) return `declared in the ${side} manifest`;

  const rest = Object.entries(metadata)
    .map(([key, value]) => {
      const printable = scalar(value);
      return printable === null ? null : `${key}: ${printable}`;
    })
    .filter((entry): entry is string => entry !== null);

  return rest.length === 0 ? null : rest.join(' · ');
}
