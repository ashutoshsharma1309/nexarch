/**
 * Starter prompts (Step 4).
 *
 * A blank prompt box is the hardest part of a first run: it asks the user
 * to know, cold, how much detail NexArch wants. These are the answer by
 * example — each is a real, buildable application described the way the
 * pipeline reads best: a domain, its core nouns, and the few features that
 * make it that app rather than a generic CRUD skeleton.
 */
export interface PromptExample {
  label: string;
  prompt: string;
}

export const PROMPT_EXAMPLES: PromptExample[] = [
  {
    label: 'Task manager',
    prompt:
      'Build a task manager with authentication, projects, tasks with due dates and priorities, labels, and a dashboard of what is due this week.',
  },
  {
    label: 'Blog platform',
    prompt:
      'Build a blogging platform with authentication, posts with tags, draft and published states, comments, and an author dashboard.',
  },
  {
    label: 'Bookstore',
    prompt:
      'Build an online bookstore with a catalog of books, authors and categories, a shopping cart, orders, and an admin area to manage inventory.',
  },
  {
    label: 'Help desk',
    prompt:
      'Build a support help desk with authentication, tickets that have a status and priority, assignment to agents, threaded replies, and a queue dashboard.',
  },
];

/**
 * The demo project's fixed name — kept in sync with the server's
 * DEMO_PROJECT_NAME so the UI can label a demo project (Step 18) without a
 * dedicated flag on the record.
 */
export const DEMO_PROJECT_NAME = 'Demo · Project Management SaaS';

/** True for the deterministic demo project, so the UI can badge it. */
export function isDemoProject(name: string): boolean {
  return name === DEMO_PROJECT_NAME;
}
