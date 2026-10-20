/**
 * Shared ground truth for the E2E suite.
 *
 * Every spec here drives the real console against the real API, so the first
 * question each one has to answer is whether there is anything running to
 * drive. A spec that fails because nobody started `npm run dev` is noise: it
 * reads like a regression and it is not one. These helpers turn that case
 * into a skip carrying a sentence that says what to do instead.
 *
 * They also hold the console-output watcher. A blank preview — the failure
 * that shipped last week — is silent in the DOM and loud in the console, so
 * reading the console is not optional extra rigour here; it is the only place
 * that particular defect is visible.
 */
import { test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Vite proxies `/api` to the server in development and nginx does the same in
 * production, so one origin answers for both and the probe needs no second
 * URL to configure.
 */
const LIVENESS_PATH = '/api/v1/health/live';

/** Projects the console knows about, and one project's whole graph. */
const PROJECTS_PATH = '/api/v1/projects';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Unwraps the API's `{ success, data, meta }` success envelope. */
function envelopeData(body: unknown): unknown {
  const record = asRecord(body);
  return record === null ? null : record.data;
}

/**
 * Why the suite cannot run, or `null` when it can.
 *
 * Deliberately not cached across tests: the probe is one cheap request, and a
 * cached "it was up when the run started" would report a stack that died
 * mid-suite as a product failure.
 */
export async function appUnavailableReason(request: APIRequestContext): Promise<string | null> {
  try {
    const response = await request.get(LIVENESS_PATH, { timeout: 5_000 });
    if (!response.ok()) {
      return `the API answered ${String(response.status())} at ${LIVENESS_PATH}`;
    }
    return null;
  } catch {
    return 'nothing answered at the base URL';
  }
}

/** So the explanation below is printed once per run, not once per spec. */
let announced = false;

/**
 * Call from `beforeEach`. When the stack is not up, the test is skipped with
 * the command that would make it runnable rather than a connection-refused
 * stack trace.
 *
 * The reason is also written to stdout, because the default `list` reporter
 * prints a bare `-` for a skipped test and keeps the annotation in the HTML
 * report — which is the one place someone running `npm run test:e2e` for the
 * first time will not look.
 *
 * Note that this hook asks only for the `request` fixture, never `page`, so
 * it resolves before Playwright needs a browser. On a machine that has not
 * run `test:e2e:install` yet, the skip still happens cleanly instead of
 * failing on a missing Chromium.
 */
export async function skipWhenAppIsNotRunning(
  request: APIRequestContext,
  baseURL: string | undefined,
): Promise<void> {
  const reason = await appUnavailableReason(request);
  if (reason === null) return;

  const explanation =
    `The NexArch console is not running at ${baseURL ?? '(no baseURL configured)'} — ` +
    `${reason}. Start it with \`npm run dev\`, or point E2E_BASE_URL at a running ` +
    `instance, then run \`npm run test:e2e\` again.`;

  if (!announced) {
    announced = true;
    process.stdout.write(`\nSkipping the end-to-end suite. ${explanation}\n\n`);
  }

  test.skip(true, explanation);
}

export interface ConsoleWatch {
  /** Error-level console output, in the order the browser emitted it. */
  readonly consoleErrors: string[];
  /** Uncaught exceptions. These are what leave a React tree unmounted. */
  readonly pageErrors: string[];
}

/**
 * Starts recording console output for a page, including its iframes — which
 * is what makes the generated app inside the preview frame observable from
 * out here.
 *
 * There is no ignore-list on purpose. An allow-list of "known harmless"
 * console errors is exactly where a real regression hides, and this project
 * has already been burned once by output nobody was reading.
 */
export function watchConsole(page: Page): ConsoleWatch {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return { consoleErrors, pageErrors };
}

/** The fields of the engineering graph these specs actually read. */
interface GraphNode {
  id: string;
  name: string;
  type: string;
  canonicalName: string;
}

interface GraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface BuiltProjectGraph {
  projectId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeCount: number;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readGraphNode(value: unknown): GraphNode | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = readString(record, 'id');
  const name = readString(record, 'name');
  const type = readString(record, 'type');
  const canonicalName = readString(record, 'canonicalName');
  if (id === null || name === null || type === null || canonicalName === null) return null;
  return { id, name, type, canonicalName };
}

function readGraphEdge(value: unknown): GraphEdge | null {
  const record = asRecord(value);
  if (record === null) return null;
  const sourceNodeId = readString(record, 'sourceNodeId');
  const targetNodeId = readString(record, 'targetNodeId');
  if (sourceNodeId === null || targetNodeId === null) return null;
  return { sourceNodeId, targetNodeId };
}

function readGraph(projectId: string, body: unknown): BuiltProjectGraph | null {
  const data = asRecord(envelopeData(body));
  if (data === null) return null;

  const rawNodes = data.nodes;
  const rawEdges = data.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;

  const nodes: GraphNode[] = [];
  for (const entry of rawNodes) {
    const node = readGraphNode(entry);
    if (node !== null) nodes.push(node);
  }

  const edges: GraphEdge[] = [];
  for (const entry of rawEdges) {
    const edge = readGraphEdge(entry);
    if (edge !== null) edges.push(edge);
  }

  return { projectId, nodes, edges, nodeCount: nodes.length };
}

/**
 * The first project in this workspace whose graph has something in it.
 *
 * The Knowledge Graph only exists for a project that has been built, and a
 * build costs an AI call and a minute or two. Rather than build one here —
 * which would make this spec a duplicate of `build-and-preview` with a
 * different assertion at the end — it looks for a project that already has
 * one and skips when there is none.
 */
export async function findProjectWithGraph(
  request: APIRequestContext,
): Promise<BuiltProjectGraph | null> {
  const listResponse = await request.get(PROJECTS_PATH);
  if (!listResponse.ok()) return null;

  const projects = envelopeData(await listResponse.json());
  if (!Array.isArray(projects)) return null;

  for (const entry of projects) {
    const record = asRecord(entry);
    const projectId = record === null ? null : readString(record, 'id');
    if (projectId === null) continue;

    const graphResponse = await request.get(`${PROJECTS_PATH}/${projectId}/graph`);
    if (!graphResponse.ok()) continue;

    const graph = readGraph(projectId, await graphResponse.json());
    // Two nodes is the floor for "search narrows the graph" to mean anything.
    if (graph !== null && graph.nodeCount >= 2) return graph;
  }

  return null;
}

/**
 * A search term that is known to leave some of the graph behind.
 *
 * The console's search keeps every match *and* each match's immediate
 * neighbours, so "search for a node name" does not reliably narrow anything:
 * in a dense graph one name can pull in the whole picture. This replays that
 * rule over the graph the API returned purely to *choose* a term whose result
 * is smaller than the whole — the spec still asserts on what the UI shows,
 * not on this prediction.
 *
 * Returns `null` for a graph where no single term narrows it, which is a
 * legitimate shape (a tiny, fully connected graph) and a skip rather than a
 * failure.
 */
export function chooseNarrowingSearch(graph: BuiltProjectGraph): string | null {
  let best: { term: string; visible: number } | null = null;

  for (const candidate of graph.nodes) {
    const term = candidate.name.trim();
    if (term === '') continue;

    const needle = term.toLowerCase();
    const matched = new Set(
      graph.nodes
        .filter(
          (node) =>
            node.name.toLowerCase().includes(needle) ||
            node.type.toLowerCase().includes(needle) ||
            node.canonicalName.toLowerCase().includes(needle),
        )
        .map((node) => node.id),
    );
    if (matched.size === 0) continue;

    const kept = new Set(matched);
    for (const edge of graph.edges) {
      if (matched.has(edge.sourceNodeId)) kept.add(edge.targetNodeId);
      if (matched.has(edge.targetNodeId)) kept.add(edge.sourceNodeId);
    }

    if (kept.size < graph.nodeCount && (best === null || kept.size < best.visible)) {
      best = { term, visible: kept.size };
    }
  }

  return best === null ? null : best.term;
}

/**
 * The graph toolbar's own count, read off the screen as `visible/total`.
 *
 * `exec` rather than `String.match`: the repo's ESLint config forbids the
 * latter where the former works.
 */
export function readNodeCounter(text: string): { visible: number; total: number } | null {
  const parsed = /(\d+)\s*\/\s*(\d+)\s+nodes/.exec(text);
  const visible = parsed?.[1];
  const total = parsed?.[2];
  if (visible === undefined || total === undefined) return null;
  return { visible: Number(visible), total: Number(total) };
}
