/** What research cost. An unreported figure reads "Not available", never zero. */
import type { ResearchModelCall, ResearchUsage } from '@/shared/types/research';
import { Section } from './research-shared';

const NOT_AVAILABLE = 'Not available';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className="font-mono text-xs text-fg">{value}</dd>
    </div>
  );
}

function tokens(value: number | null): string {
  return value === null ? NOT_AVAILABLE : value.toLocaleString();
}

function cost(value: number | null): string {
  return value === null ? NOT_AVAILABLE : `$${value.toFixed(4)}`;
}

/** The sum of what was reported, marked when some calls reported nothing. */
function knownTotal(
  calls: ResearchModelCall[],
  pick: (call: ResearchModelCall) => number | null,
  format: (value: number) => string,
): string {
  const known = calls.map(pick).filter((value): value is number => value !== null);
  if (known.length === 0) return NOT_AVAILABLE;
  const total = format(known.reduce((sum, value) => sum + value, 0));
  const missing = calls.length - known.length;
  return missing === 0 ? total : `At least ${total} (${String(missing)} not reported)`;
}

function ModelCalls({ calls }: { calls: ResearchModelCall[] }) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
        Model calls ({calls.length})
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-120 text-left text-2xs text-fg-muted">
          <thead className="text-fg-subtle">
            <tr>
              <th scope="col" className="py-1 pr-3 font-normal">
                Purpose
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Model
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Result
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Input
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Output
              </th>
              <th scope="col" className="py-1 font-normal">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, index) => (
              <tr key={`${call.purpose}-${String(index)}`} className="border-t border-line">
                <td className="py-1 pr-3">{call.purpose}</td>
                <td className="py-1 pr-3 break-all">
                  {call.provider}/{call.model}
                </td>
                <td className="py-1 pr-3">
                  {call.status === 'success' ? 'Succeeded' : 'Failed'}
                  {call.cacheHit ? ', cached' : ''}
                </td>
                <td className="py-1 pr-3">{tokens(call.inputTokens)}</td>
                <td className="py-1 pr-3">{tokens(call.outputTokens)}</td>
                <td className="py-1">{cost(call.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ResearchUsageSection({ usage }: { usage: ResearchUsage }) {
  const calls = usage.modelCalls;
  return (
    <Section title="Usage">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Searches sent" value={String(usage.searches)} />
        <Stat label="Pages extracted" value={String(usage.extractions)} />
        <Stat label="Search cache hits" value={String(usage.searchCacheHits)} />
        <Stat label="Extraction cache hits" value={String(usage.extractionCacheHits)} />
        <Stat label="Brave searches" value={String(usage.byProvider.brave.searches)} />
        <Stat label="Tavily searches" value={String(usage.byProvider.tavily.searches)} />
        <Stat label="Duration" value={`${(usage.durationMs / 1000).toFixed(1)} s`} />
        <Stat
          label="Input tokens"
          value={knownTotal(
            calls,
            (call) => call.inputTokens,
            (n) => n.toLocaleString(),
          )}
        />
        <Stat
          label="Output tokens"
          value={knownTotal(
            calls,
            (call) => call.outputTokens,
            (n) => n.toLocaleString(),
          )}
        />
        <Stat
          label="Model cost"
          value={knownTotal(
            calls,
            (call) => call.costUsd,
            (n) => `$${n.toFixed(4)}`,
          )}
        />
      </dl>
      {calls.length > 0 && <ModelCalls calls={calls} />}
      {usage.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-2xs leading-relaxed text-fg-subtle">
          {usage.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}
