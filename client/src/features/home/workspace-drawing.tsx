/**
 * The Home drawing: a construction elevation of the NexArch arch, dimensioned
 * with this workspace's real figures.
 *
 * The annotations are data, not decoration. The span is how many projects
 * exist, the rise is how many are active, and the note under the ground line
 * is when the last one changed. While the figures are unknown the dimensions
 * say so: a drawing that printed "0 projects" during a failed request would
 * be stating something false.
 */
export interface WorkspaceDrawingProps {
  /** Null while loading or when the projects could not be read. */
  total: number | null;
  active: number | null;
  lastChange: string | null;
}

function count(value: number | null, singular: string, plural: string): string {
  if (value === null) return `— ${plural}`;
  return `${String(value)} ${value === 1 ? singular : plural}`;
}

const DIMENSION = 'fill-none stroke-fg-subtle';

export function WorkspaceDrawing({ total, active, lastChange }: WorkspaceDrawingProps) {
  const span = count(total, 'project', 'projects');
  const rise = active === null ? '— active' : `${String(active)} active`;
  const known = total !== null;
  const note = !known
    ? 'last change —'
    : lastChange
      ? `last change ${lastChange}`
      : 'no changes recorded';

  return (
    <svg
      viewBox="0 0 360 306"
      role="img"
      aria-label={
        known
          ? `Workspace: ${span}, ${rise}${lastChange ? `, last changed ${lastChange}` : ''}`
          : 'Workspace figures are not available yet'
      }
      className="h-auto w-full font-mono"
    >
      {/* Span dimension */}
      <path d="M70 38H290 M70 30v16 M290 30v16" className={DIMENSION} strokeWidth="1" />
      <text x="180" y="26" textAnchor="middle" fontSize="12" className="fill-fg-muted">
        {span}
      </text>

      {/* The arch: the logo's profile, drawn in outline */}
      <path
        d="M70 268V62h220v206h-50V112H120v156Z"
        className="fill-surface stroke-fg-muted"
        strokeWidth="1.25"
      />
      <path d="M70 87h220" className="stroke-line-strong" strokeWidth="1" strokeDasharray="3 4" />

      {/* What the architecture is for */}
      <rect x="158" y="188" width="44" height="44" className="fill-ember" />

      {/* Rise dimension */}
      <path d="M326 62V268 M318 62h16 M318 268h16" className={DIMENSION} strokeWidth="1" />
      <text
        x="346"
        y="165"
        textAnchor="middle"
        fontSize="12"
        className="fill-fg-muted"
        transform="rotate(90 346 165)"
      >
        {rise}
      </text>

      {/* Ground line and note */}
      <path d="M28 268H340" className="stroke-fg-muted" strokeWidth="1.25" />
      <text x="70" y="292" fontSize="12" className="fill-fg-subtle">
        {note}
      </text>
    </svg>
  );
}
