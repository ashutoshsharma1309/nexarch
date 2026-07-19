/**
 * Database-design knowledge base.
 *
 * The column inference table encodes what an experienced DBA reads from a
 * field name: `price` is money, `email` is a unique indexed string, `*_at`
 * is a timestamp. Rules are matched in order (first hit wins) against the
 * snake_case column name. Adding domain vocabulary is a data change here,
 * never a code change in the designer.
 */

export interface ColumnTypeSpec {
  sqlType: string;
  prismaType: string;
  prismaNativeType?: string;
  /** Semantic format for validation/OpenAPI, e.g. `email`, `uuid`, `date-time`. */
  format?: string;
  /** Non-negative numeric guard (money, quantities). */
  nonNegative?: boolean;
}

export interface InferenceRule {
  /** Matches the whole column name. */
  match: (column: string) => boolean;
  spec: ColumnTypeSpec;
}

const exact =
  (...names: string[]) =>
  (column: string): boolean =>
    names.includes(column);
const suffix =
  (...suffixes: string[]) =>
  (column: string): boolean =>
    suffixes.some((s) => column.endsWith(s));
const contains =
  (...tokens: string[]) =>
  (column: string): boolean =>
    tokens.some((t) => column === t || column.includes(t));

/** Ordered inference rules. `*_id` foreign keys are handled by the relationship
 * engine before inference runs, so no FK rule is needed here. */
export const INFERENCE_RULES: readonly InferenceRule[] = [
  {
    match: exact('email'),
    spec: {
      sqlType: 'VARCHAR(320)',
      prismaType: 'String',
      prismaNativeType: '@db.VarChar(320)',
      format: 'email',
    },
  },
  {
    match: exact('password_hash', 'password'),
    spec: { sqlType: 'VARCHAR(255)', prismaType: 'String', prismaNativeType: '@db.VarChar(255)' },
  },
  {
    match: exact('slug'),
    spec: {
      sqlType: 'VARCHAR(191)',
      prismaType: 'String',
      prismaNativeType: '@db.VarChar(191)',
      format: 'slug',
    },
  },
  {
    match: contains('phone', 'mobile', 'whatsapp'),
    spec: {
      sqlType: 'VARCHAR(32)',
      prismaType: 'String',
      prismaNativeType: '@db.VarChar(32)',
      format: 'phone',
    },
  },
  {
    match: contains(
      'price',
      'amount',
      'total',
      'balance',
      'cost',
      'salary',
      'fee',
      'fare',
      'rate',
      'subtotal',
      'tax',
      'wage',
      'budget',
    ),
    spec: {
      sqlType: 'DECIMAL(12,2)',
      prismaType: 'Decimal',
      prismaNativeType: '@db.Decimal(12, 2)',
      nonNegative: true,
    },
  },
  {
    match: contains(
      'quantity',
      'qty',
      'stock',
      'count',
      'capacity',
      'duration',
      'age',
      'score',
      'marks',
      'points',
      'reorder_level',
      'threshold',
    ),
    spec: { sqlType: 'INT', prismaType: 'Int', nonNegative: true },
  },
  {
    match: (c) => c.startsWith('is_') || c.startsWith('has_'),
    spec: { sqlType: 'BOOLEAN', prismaType: 'Boolean' },
  },
  {
    match: exact(
      'active',
      'available',
      'published',
      'verified',
      'enabled',
      'paid',
      'completed',
      'featured',
      'archived',
    ),
    spec: { sqlType: 'BOOLEAN', prismaType: 'Boolean' },
  },
  {
    match: exact(
      'check_in',
      'check_out',
      'scheduled_at',
      'published_at',
      'sent_at',
      'read_at',
      'started_at',
      'completed_at',
      'expires_at',
      'verified_at',
    ),
    spec: { sqlType: 'DATETIME', prismaType: 'DateTime' },
  },
  { match: suffix('_at'), spec: { sqlType: 'DATETIME', prismaType: 'DateTime' } },
  {
    match: exact(
      'dob',
      'birth_date',
      'date_of_birth',
      'start_date',
      'end_date',
      'due_date',
      'issue_date',
      'joining_date',
    ),
    spec: { sqlType: 'DATE', prismaType: 'DateTime', prismaNativeType: '@db.Date', format: 'date' },
  },
  {
    match: suffix('_date'),
    spec: { sqlType: 'DATE', prismaType: 'DateTime', prismaNativeType: '@db.Date', format: 'date' },
  },
  {
    match: contains(
      'description',
      'body',
      'content',
      'notes',
      'note',
      'address',
      'bio',
      'message',
      'remarks',
      'comment',
      'summary',
      'about',
    ),
    spec: { sqlType: 'TEXT', prismaType: 'String', prismaNativeType: '@db.Text' },
  },
  {
    match: contains(
      'sku',
      'barcode',
      'isbn',
      'employee_no',
      'account_no',
      'invoice_no',
      'reference',
      'provider_ref',
      'transaction_ref',
    ),
    spec: { sqlType: 'VARCHAR(64)', prismaType: 'String', prismaNativeType: '@db.VarChar(64)' },
  },
  {
    match: exact('number', 'no', 'code', 'ref'),
    spec: { sqlType: 'VARCHAR(64)', prismaType: 'String', prismaNativeType: '@db.VarChar(64)' },
  },
  {
    match: contains(
      'url',
      'link',
      'image',
      'photo',
      'avatar',
      'thumbnail',
      'file',
      'attachment',
      'document',
    ),
    spec: {
      sqlType: 'VARCHAR(512)',
      prismaType: 'String',
      prismaNativeType: '@db.VarChar(512)',
      format: 'uri',
    },
  },
  {
    match: contains('metadata', 'settings', 'preferences', 'config', 'payload', 'options'),
    spec: { sqlType: 'JSON', prismaType: 'Json' },
  },
  {
    match: contains('name', 'title', 'subject', 'label', 'designation'),
    spec: { sqlType: 'VARCHAR(255)', prismaType: 'String', prismaNativeType: '@db.VarChar(255)' },
  },
];

/** Fallback when nothing matches. */
export const DEFAULT_COLUMN_SPEC: ColumnTypeSpec = {
  sqlType: 'VARCHAR(255)',
  prismaType: 'String',
  prismaNativeType: '@db.VarChar(255)',
};

/** Column names that carry an enumerable state — always emitted as enums. */
export const ENUM_COLUMNS: ReadonlySet<string> = new Set([
  'status',
  'state',
  'type',
  'role',
  'category',
  'gender',
  'mode',
  'method',
  'priority',
  'payment_status',
]);

/**
 * Known enum value sets, keyed by `Entity.column` first, then bare `column`.
 * Anything not found falls back to a generic ACTIVE/INACTIVE lifecycle.
 */
export const ENUM_VALUES: Readonly<Record<string, string[]>> = {
  'Orders.status': [
    'PENDING',
    'CONFIRMED',
    'PAID',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED',
  ],
  'Payments.status': ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
  'Invoices.status': ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID'],
  'Appointments.status': ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  'Bookings.status': ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'],
  'Transactions.type': ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'PAYMENT', 'REFUND'],
  'Loans.status': ['APPLIED', 'APPROVED', 'DISBURSED', 'CLOSED', 'REJECTED'],
  'Leaves.status': ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  'Tickets.status': ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  'Tasks.status': ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'],
  'Deals.status': ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'],
  'Leads.status': ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'],
  gender: ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'],
  priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
  status: ['ACTIVE', 'INACTIVE'],
  type: ['STANDARD', 'PREMIUM'],
  method: ['CARD', 'CASH', 'UPI', 'BANK_TRANSFER', 'WALLET'],
  mode: ['ONLINE', 'OFFLINE'],
};

/** Reference/lookup tables that are read far more than written. */
export const CACHE_CANDIDATE_ENTITIES: ReadonlySet<string> = new Set([
  'Products',
  'Categories',
  'MenuItems',
  'Rooms',
  'RoomTypes',
  'Courses',
  'Departments',
  'Classes',
  'Subjects',
  'Suppliers',
]);

/** High-volume append-mostly tables worth range-partitioning by time. */
export const PARTITION_CANDIDATE_ENTITIES: ReadonlySet<string> = new Set([
  'Transactions',
  'Messages',
  'Orders',
  'StockMovements',
  'AttendanceRecords',
  'Notifications',
  'Activities',
  'Submissions',
]);
