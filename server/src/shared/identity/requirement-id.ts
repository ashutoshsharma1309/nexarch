/**
 * One requirement, one id, computed in one place.
 *
 * A requirement gets named several times before anyone reads it: the
 * analyzer writes it ("Email Notifications"), the graph stores it as a
 * `REQUIREMENT` node, and a finding points back at it. Each of those sites
 * needs the same answer to "which requirement is this?", and when each
 * derives its own the answers drift — which is how one gap turns into two
 * records, or how a finding ends up identified by nothing but a title it
 * shares with every other gap.
 *
 * This is *not* a new id scheme, and that is the whole point. What it
 * returns is exactly `canonicalize`'s output: the string already stored as
 * `GraphNode.canonicalName` for every `REQUIREMENT` node, already unique
 * per `@@unique([projectId, type, canonicalName])`. A second scheme here —
 * a slug, a hash — would produce ids that match nothing in `graph_nodes`,
 * which is strictly worse than having no id at all. `slugify` and
 * `kebabCase` in `shared/utils/strings.ts` are exactly that trap: they fold
 * neither role suffixes nor plurals, so "Orders", "Order Management" and
 * "OrderService" come back as three ids for one requirement.
 *
 * On the import direction: `shared/` reaching into `modules/` is backwards
 * here — module islands are meant to be the leaves, and `shared/` the layer
 * beneath them. The right shape is for the canonicalization itself to live
 * in this folder and for the graph's `lib/canonical.ts` to re-export it.
 * That relocation is deliberately not made in this change: moving the
 * implementation is only safe when every caller moves with it, and
 * `canonical.ts` plus its callers sit outside the files this change may
 * touch. Re-exporting instead keeps the behaviour bit-identical and the
 * risk of a divergent second scheme at zero, which is the property that
 * actually matters. Until the move, treat this as the public name for the
 * graph's canonicalization and the one site to change if that ever moves.
 */
import { canonicalize } from '../../modules/engineering-graph/lib/canonical.js';

/**
 * The stable identity of a requirement, derived from how it is written.
 *
 * `Email Notifications` → `email-notification` ·
 * `EmailNotificationService` → `email-notification` ·
 * `Order Management` → `order`
 */
export function requirementId(text: string): string {
  return canonicalize(text);
}
