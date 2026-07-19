/**
 * Domain knowledge base: one profile per project type the analyzer can
 * classify. A profile encodes what an experienced architect assumes for the
 * domain — default roles and modules, core entities, typical integrations,
 * the features teams forget to ask for (`expected` → missingRequirements),
 * and the clarifying questions worth asking when a prompt is thin.
 *
 * Classification is additive scoring: strong keywords identify the domain
 * outright, weak keywords are corroborating vocabulary. Adding a domain is
 * appending a profile — no pipeline code changes.
 */
import type { ClarifyingQuestion } from '../analysis.types.js';

/** How much detail a domain needs before analysis can proceed without
 * questions: simple sites have sane defaults, complex systems do not. */
export type DomainComplexity = 'simple' | 'standard' | 'complex';

export interface ExpectedFeature {
  readonly label: string;
  /** Phrases that count as the user having covered this feature. */
  readonly coveredBy: readonly string[];
}

export interface DomainProfile {
  readonly id: string;
  /** Canonical `projectType` value, e.g. "Ecommerce". */
  readonly type: string;
  /** Default `projectName` when the prompt doesn't name the project. */
  readonly defaultName: string;
  readonly complexity: DomainComplexity;
  readonly strongKeywords: readonly string[];
  readonly weakKeywords: readonly string[];
  readonly roles: readonly string[];
  readonly modules: readonly string[];
  readonly entities: readonly string[];
  readonly integrations: readonly string[];
  readonly expected: readonly ExpectedFeature[];
  readonly questions: readonly ClarifyingQuestion[];
}

export const DOMAIN_PROFILES: readonly DomainProfile[] = [
  {
    id: 'ecommerce',
    type: 'Ecommerce',
    defaultName: 'Ecommerce Platform',
    complexity: 'standard',
    strongKeywords: [
      'ecommerce',
      'e-commerce',
      'e commerce',
      'online store',
      'online shop',
      'shopping website',
      'shopping site',
      'shopping app',
      'storefront',
      'marketplace',
    ],
    weakKeywords: ['shop', 'cart', 'checkout', 'products', 'orders', 'sellers', 'store'],
    roles: ['Admin', 'Customer'],
    modules: [
      'Authentication',
      'Dashboard',
      'Products',
      'Cart',
      'Orders',
      'Payments',
      'Reviews',
      'Notifications',
      'Settings',
    ],
    entities: [
      'Users',
      'Products',
      'Categories',
      'Carts',
      'CartItems',
      'Orders',
      'OrderItems',
      'Payments',
      'Reviews',
      'Addresses',
    ],
    integrations: ['Payment Gateway', 'Email'],
    expected: [
      {
        label: 'Payment Gateway',
        coveredBy: ['payment', 'stripe', 'razorpay', 'paypal', 'checkout'],
      },
      { label: 'Order Tracking', coveredBy: ['order tracking', 'track order', 'shipping status'] },
      { label: 'Search & Filtering', coveredBy: ['search', 'filter', 'filtering'] },
      { label: 'Email Notifications', coveredBy: ['email', 'notification', 'notifications'] },
    ],
    questions: [
      {
        aspect: 'roles',
        text: 'Which roles are needed beyond Admin and Customer — for example Vendors?',
      },
      {
        aspect: 'modules',
        text: 'Which store features matter most: reviews, wishlists, coupons, inventory?',
      },
      {
        aspect: 'payments',
        text: 'Should online payments be included, and with which provider (Stripe, Razorpay, PayPal)?',
      },
      {
        aspect: 'auth',
        text: 'How should customers sign in — email/password, Google login, or OTP?',
      },
    ],
  },
  {
    id: 'crm',
    type: 'CRM',
    defaultName: 'CRM Platform',
    complexity: 'standard',
    strongKeywords: ['crm', 'customer relationship', 'sales crm'],
    weakKeywords: ['leads', 'pipeline', 'deals', 'contacts', 'follow up', 'sales team'],
    roles: ['Admin', 'Manager', 'Sales Rep'],
    modules: [
      'Authentication',
      'Dashboard',
      'Leads',
      'Contacts',
      'Deals',
      'Tasks',
      'Reports',
      'Notifications',
      'Settings',
    ],
    entities: ['Users', 'Leads', 'Contacts', 'Companies', 'Deals', 'Tasks', 'Activities', 'Notes'],
    integrations: ['Email'],
    expected: [
      { label: 'Email Integration', coveredBy: ['email', 'smtp', 'gmail'] },
      { label: 'Reports & Analytics', coveredBy: ['report', 'analytics', 'chart'] },
      { label: 'Lead Import/Export', coveredBy: ['import', 'export', 'csv', 'excel'] },
    ],
    questions: [
      {
        aspect: 'roles',
        text: 'How is the sales team structured — managers, reps, separate support agents?',
      },
      {
        aspect: 'modules',
        text: 'Which pipeline stages and activities should be tracked (calls, meetings, emails)?',
      },
      {
        aspect: 'integrations',
        text: 'Should the CRM send emails directly, or integrate with an external mailbox?',
      },
      { aspect: 'auth', text: 'Is single sign-on (Google/OAuth) required for the team?' },
    ],
  },
  {
    id: 'hospital',
    type: 'Hospital',
    defaultName: 'Hospital Management',
    complexity: 'complex',
    strongKeywords: ['hospital', 'clinic', 'healthcare', 'health care', 'medical center', 'hms'],
    weakKeywords: ['patient', 'doctor', 'appointment', 'prescription', 'ward', 'pharmacy', 'lab'],
    roles: ['Admin', 'Doctor', 'Patient', 'Receptionist'],
    modules: [
      'Authentication',
      'Dashboard',
      'Appointments',
      'Patients',
      'Doctors',
      'Prescriptions',
      'Billing',
      'Reports',
      'Notifications',
      'Settings',
    ],
    entities: [
      'Users',
      'Doctors',
      'Patients',
      'Departments',
      'Appointments',
      'Prescriptions',
      'MedicalRecords',
      'Invoices',
    ],
    integrations: ['Email', 'SMS'],
    expected: [
      { label: 'Payment Gateway', coveredBy: ['payment', 'billing online', 'stripe', 'razorpay'] },
      {
        label: 'Appointment Reminders',
        coveredBy: ['reminder', 'reminders', 'sms', 'notification'],
      },
      { label: 'Medical Records Export', coveredBy: ['pdf', 'export', 'medical records'] },
    ],
    questions: [
      {
        aspect: 'roles',
        text: 'Which staff roles are needed — doctors, nurses, receptionists, lab technicians?',
      },
      {
        aspect: 'modules',
        text: 'Do patients book appointments themselves, or does the front desk manage them?',
      },
      { aspect: 'payments', text: 'Should billing and online payments be included?' },
      { aspect: 'integrations', text: 'Are SMS or email appointment reminders needed?' },
    ],
  },
  {
    id: 'school',
    type: 'School',
    defaultName: 'School Management',
    complexity: 'complex',
    strongKeywords: ['school', 'school erp', 'school management', 'college', 'university'],
    weakKeywords: ['student', 'teacher', 'class', 'attendance', 'exam', 'timetable', 'fees'],
    roles: ['Admin', 'Teacher', 'Student', 'Parent'],
    modules: [
      'Authentication',
      'Dashboard',
      'Students',
      'Teachers',
      'Classes',
      'Attendance',
      'Exams',
      'Timetable',
      'Fees',
      'Notifications',
      'Settings',
    ],
    entities: [
      'Users',
      'Students',
      'Teachers',
      'Classes',
      'Sections',
      'Subjects',
      'AttendanceRecords',
      'Exams',
      'Grades',
      'FeePayments',
    ],
    integrations: ['Email', 'SMS'],
    expected: [
      { label: 'Fee Payments', coveredBy: ['fee', 'fees', 'payment'] },
      { label: 'Parent Notifications', coveredBy: ['parent', 'notification', 'sms'] },
      { label: 'Report Cards Export', coveredBy: ['report card', 'pdf', 'export'] },
    ],
    questions: [
      {
        aspect: 'roles',
        text: 'Which roles are needed — teachers, students, parents, non-teaching staff?',
      },
      {
        aspect: 'modules',
        text: 'Which academic features matter: attendance, exams, timetable, homework?',
      },
      { aspect: 'payments', text: 'Should fee collection with online payment be included?' },
      { aspect: 'integrations', text: 'Should parents receive SMS/email updates?' },
    ],
  },
  {
    id: 'erp',
    type: 'ERP',
    defaultName: 'ERP System',
    complexity: 'complex',
    strongKeywords: ['erp', 'enterprise resource planning'],
    weakKeywords: ['procurement', 'finance', 'inventory', 'hr', 'departments', 'ledger'],
    roles: ['Admin', 'Manager', 'Employee', 'Accountant'],
    modules: [
      'Authentication',
      'Dashboard',
      'Inventory',
      'Suppliers',
      'Sales',
      'Finance',
      'HR',
      'Reports',
      'Settings',
    ],
    entities: [
      'Users',
      'Employees',
      'Departments',
      'Products',
      'Suppliers',
      'PurchaseOrders',
      'SalesOrders',
      'Invoices',
      'LedgerEntries',
    ],
    integrations: ['Email'],
    expected: [
      { label: 'Role Based Access', coveredBy: ['role based', 'rbac', 'permissions'] },
      { label: 'Reports & Analytics', coveredBy: ['report', 'analytics', 'chart'] },
      { label: 'Data Export', coveredBy: ['export', 'excel', 'csv', 'pdf'] },
    ],
    questions: [
      {
        aspect: 'modules',
        text: 'Which ERP domains are in scope — inventory, procurement, finance, HR, sales?',
      },
      { aspect: 'roles', text: 'Which departments and approval hierarchies need their own roles?' },
      {
        aspect: 'integrations',
        text: 'Does the ERP integrate with existing accounting or payroll tools?',
      },
      { aspect: 'auth', text: 'Is single sign-on or two-factor authentication required?' },
    ],
  },
  {
    id: 'portfolio',
    type: 'Portfolio',
    defaultName: 'Portfolio Website',
    complexity: 'simple',
    strongKeywords: [
      'portfolio',
      'personal website',
      'personal site',
      'resume website',
      'cv website',
    ],
    weakKeywords: ['projects showcase', 'about me', 'freelancer'],
    roles: ['Admin', 'Visitor'],
    modules: ['Authentication', 'Projects', 'About', 'Contact', 'Settings'],
    entities: ['Users', 'Projects', 'Skills', 'ContactMessages'],
    integrations: ['Email'],
    expected: [
      { label: 'Contact Form Email', coveredBy: ['contact', 'email'] },
      { label: 'Project Gallery', coveredBy: ['gallery', 'projects', 'showcase'] },
    ],
    questions: [
      { aspect: 'modules', text: 'Should the portfolio include a blog or only project pages?' },
      { aspect: 'integrations', text: 'Should the contact form deliver messages by email?' },
    ],
  },
  {
    id: 'blog',
    type: 'Blog',
    defaultName: 'Blog Platform',
    complexity: 'simple',
    strongKeywords: ['blog', 'blogging platform', 'cms', 'content management'],
    weakKeywords: ['posts', 'articles', 'authors', 'comments'],
    roles: ['Admin', 'Author', 'Reader'],
    modules: ['Authentication', 'Dashboard', 'Posts', 'Comments', 'Media', 'Settings'],
    entities: ['Users', 'Posts', 'Categories', 'Tags', 'Comments', 'Media'],
    integrations: [],
    expected: [
      { label: 'Rich Text Editor', coveredBy: ['editor', 'rich text', 'markdown'] },
      { label: 'Comment Moderation', coveredBy: ['moderation', 'comments'] },
    ],
    questions: [
      { aspect: 'roles', text: 'Is this a single-author blog or a multi-author platform?' },
      { aspect: 'modules', text: 'Are comments, categories, and media uploads needed?' },
    ],
  },
  {
    id: 'chat',
    type: 'Chat',
    defaultName: 'Chat Application',
    complexity: 'standard',
    strongKeywords: ['chat app', 'chat application', 'messaging app', 'messenger', 'chat system'],
    weakKeywords: ['messages', 'group chat', 'conversations', 'dm'],
    roles: ['Admin', 'User'],
    modules: ['Authentication', 'Conversations', 'Contacts', 'Notifications', 'Settings'],
    entities: ['Users', 'Conversations', 'Participants', 'Messages', 'Attachments'],
    integrations: ['Real-time (Socket.io)', 'Notifications'],
    expected: [
      {
        label: 'Real-time Delivery',
        coveredBy: ['real time', 'realtime', 'socket', 'websocket', 'live'],
      },
      { label: 'Media Sharing', coveredBy: ['image', 'file', 'media', 'attachment', 'upload'] },
      { label: 'Push Notifications', coveredBy: ['notification', 'push'] },
    ],
    questions: [
      { aspect: 'modules', text: 'Are group conversations needed, or only one-to-one messaging?' },
      { aspect: 'integrations', text: 'Should media sharing (images, files) be supported?' },
      {
        aspect: 'auth',
        text: 'How do users find each other — phone contacts, usernames, invites?',
      },
    ],
  },
  {
    id: 'lms',
    type: 'LMS',
    defaultName: 'Learning Management System',
    complexity: 'standard',
    strongKeywords: [
      'lms',
      'learning management',
      'course platform',
      'online courses',
      'e-learning',
      'elearning',
      'learning platform',
    ],
    weakKeywords: ['courses', 'lessons', 'quiz', 'certificate', 'instructor', 'students'],
    roles: ['Admin', 'Instructor', 'Student'],
    modules: [
      'Authentication',
      'Dashboard',
      'Courses',
      'Enrollments',
      'Quizzes',
      'Certificates',
      'Payments',
      'Reports',
      'Settings',
    ],
    entities: [
      'Users',
      'Courses',
      'Lessons',
      'Enrollments',
      'Quizzes',
      'Questions',
      'Submissions',
      'Certificates',
    ],
    integrations: ['Payment Gateway', 'Email', 'Cloud Storage'],
    expected: [
      { label: 'Video Hosting', coveredBy: ['video', 'videos', 'streaming'] },
      { label: 'Course Payments', coveredBy: ['payment', 'paid courses', 'stripe', 'razorpay'] },
      { label: 'Progress Tracking', coveredBy: ['progress', 'tracking', 'completion'] },
    ],
    questions: [
      {
        aspect: 'modules',
        text: 'Are courses video-based, text-based, or both — and are quizzes needed?',
      },
      {
        aspect: 'payments',
        text: 'Are courses paid, and should certificates be issued on completion?',
      },
      {
        aspect: 'roles',
        text: 'Can instructors create their own courses, or does an admin publish everything?',
      },
    ],
  },
  {
    id: 'inventory',
    type: 'Inventory',
    defaultName: 'Inventory Management',
    complexity: 'standard',
    strongKeywords: [
      'inventory management',
      'inventory system',
      'stock management',
      'warehouse management',
    ],
    weakKeywords: ['stock', 'warehouse', 'suppliers', 'sku', 'purchase orders'],
    roles: ['Admin', 'Manager', 'Employee'],
    modules: [
      'Authentication',
      'Dashboard',
      'Products',
      'Inventory',
      'Suppliers',
      'Reports',
      'Notifications',
      'Settings',
    ],
    entities: [
      'Users',
      'Products',
      'Warehouses',
      'StockItems',
      'StockMovements',
      'Suppliers',
      'PurchaseOrders',
    ],
    integrations: ['Email'],
    expected: [
      { label: 'Low-stock Alerts', coveredBy: ['alert', 'low stock', 'notification', 'reminder'] },
      { label: 'Stock Reports Export', coveredBy: ['report', 'export', 'excel', 'csv'] },
      { label: 'Barcode Support', coveredBy: ['barcode', 'qr code', 'scanner'] },
    ],
    questions: [
      { aspect: 'modules', text: 'Is this single-warehouse or multi-warehouse stock tracking?' },
      { aspect: 'integrations', text: 'Should low-stock alerts be sent, and to whom?' },
      {
        aspect: 'roles',
        text: 'Who manages stock — one team, or separate purchasing and warehouse roles?',
      },
    ],
  },
  {
    id: 'banking',
    type: 'Banking',
    defaultName: 'Banking System',
    complexity: 'complex',
    strongKeywords: [
      'banking',
      'bank system',
      'bank management',
      'fintech',
      'digital wallet',
      'neobank',
    ],
    weakKeywords: ['accounts', 'transactions', 'transfer', 'loans', 'balance', 'deposits'],
    roles: ['Admin', 'Customer', 'Teller'],
    modules: [
      'Authentication',
      'Dashboard',
      'Accounts',
      'Transactions',
      'Loans',
      'Reports',
      'Notifications',
      'Settings',
    ],
    entities: ['Users', 'Accounts', 'Transactions', 'Transfers', 'Cards', 'Loans', 'Statements'],
    integrations: ['Email', 'SMS'],
    expected: [
      { label: 'Two-Factor Authentication', coveredBy: ['otp', '2fa', 'two factor', 'mfa'] },
      { label: 'Audit Logging', coveredBy: ['audit', 'audit log', 'compliance'] },
      { label: 'Statement Export', coveredBy: ['statement', 'pdf', 'export'] },
    ],
    questions: [
      {
        aspect: 'modules',
        text: 'Which banking products are in scope — accounts, transfers, cards, loans?',
      },
      { aspect: 'auth', text: 'Is OTP/two-factor authentication required for transactions?' },
      { aspect: 'roles', text: 'Which staff roles exist — tellers, managers, auditors?' },
      { aspect: 'integrations', text: 'Should customers get SMS/email alerts for transactions?' },
    ],
  },
  {
    id: 'hrms',
    type: 'HRMS',
    defaultName: 'HR Management System',
    complexity: 'standard',
    strongKeywords: [
      'hrms',
      'hr management',
      'human resource',
      'human resources',
      'employee management',
    ],
    weakKeywords: ['payroll', 'leave', 'attendance', 'recruitment', 'onboarding', 'performance'],
    roles: ['Admin', 'HR Manager', 'Employee'],
    modules: [
      'Authentication',
      'Dashboard',
      'Employees',
      'Attendance',
      'Leave Management',
      'Payroll',
      'Recruitment',
      'Reports',
      'Settings',
    ],
    entities: [
      'Users',
      'Employees',
      'Departments',
      'AttendanceRecords',
      'Leaves',
      'Payslips',
      'JobPostings',
      'Candidates',
    ],
    integrations: ['Email'],
    expected: [
      { label: 'Payroll Processing', coveredBy: ['payroll', 'salary', 'payslip'] },
      { label: 'Leave Approvals', coveredBy: ['leave', 'approval', 'time off'] },
      { label: 'Attendance Reports', coveredBy: ['attendance', 'report'] },
    ],
    questions: [
      {
        aspect: 'modules',
        text: 'Which HR functions are in scope — attendance, leave, payroll, recruitment?',
      },
      { aspect: 'roles', text: 'Do managers approve leave, or does HR handle all approvals?' },
      { aspect: 'integrations', text: 'Should payslips be emailed to employees automatically?' },
    ],
  },
  {
    id: 'hotel',
    type: 'Hotel',
    defaultName: 'Hotel Management',
    complexity: 'standard',
    strongKeywords: ['hotel', 'hotel booking', 'hotel management', 'resort', 'guest house'],
    weakKeywords: ['rooms', 'booking', 'check in', 'check out', 'housekeeping', 'guests'],
    roles: ['Admin', 'Receptionist', 'Guest'],
    modules: [
      'Authentication',
      'Dashboard',
      'Rooms',
      'Bookings',
      'Guests',
      'Billing',
      'Reports',
      'Notifications',
      'Settings',
    ],
    entities: [
      'Users',
      'Rooms',
      'RoomTypes',
      'Bookings',
      'Guests',
      'Invoices',
      'HousekeepingTasks',
    ],
    integrations: ['Payment Gateway', 'Email'],
    expected: [
      { label: 'Online Booking', coveredBy: ['online booking', 'book online', 'booking'] },
      { label: 'Payment Gateway', coveredBy: ['payment', 'stripe', 'razorpay', 'paypal'] },
      { label: 'Booking Reminders', coveredBy: ['reminder', 'notification', 'email', 'sms'] },
    ],
    questions: [
      {
        aspect: 'modules',
        text: 'Do guests book online, or are bookings entered by the front desk?',
      },
      { aspect: 'payments', text: 'Should payments/advance deposits be collected online?' },
      {
        aspect: 'roles',
        text: 'Which staff roles are needed — reception, housekeeping, management?',
      },
    ],
  },
  {
    id: 'restaurant',
    type: 'Restaurant',
    defaultName: 'Restaurant POS',
    complexity: 'standard',
    strongKeywords: [
      'restaurant',
      'restaurant pos',
      'pos',
      'point of sale',
      'food ordering',
      'food delivery',
      'cafe',
    ],
    weakKeywords: ['menu', 'orders', 'kitchen', 'tables', 'dine in', 'takeaway', 'delivery'],
    roles: ['Admin', 'Manager', 'Waiter', 'Kitchen Staff'],
    modules: [
      'Authentication',
      'Dashboard',
      'Menu',
      'Orders',
      'Tables',
      'Billing',
      'Inventory',
      'Reports',
      'Settings',
    ],
    entities: ['Users', 'MenuItems', 'Categories', 'Orders', 'OrderItems', 'Tables', 'Invoices'],
    integrations: ['Payment Gateway'],
    expected: [
      { label: 'Payment Gateway', coveredBy: ['payment', 'card', 'upi', 'stripe', 'razorpay'] },
      { label: 'Kitchen Order Display', coveredBy: ['kitchen', 'kds', 'kitchen display'] },
      { label: 'Receipt Printing', coveredBy: ['receipt', 'print', 'invoice'] },
    ],
    questions: [
      {
        aspect: 'modules',
        text: 'Is this dine-in POS, online ordering, delivery — or a combination?',
      },
      { aspect: 'payments', text: 'Which payment methods should billing support?' },
      {
        aspect: 'roles',
        text: 'Which staff use the system — waiters, kitchen, cashiers, managers?',
      },
    ],
  },
];

/** Questions used when no domain profile matches the prompt. */
export const GENERIC_QUESTIONS: readonly ClarifyingQuestion[] = [
  {
    aspect: 'modules',
    text: 'What is the main purpose of the application, and which features are essential?',
  },
  { aspect: 'roles', text: 'Who will use it, and how many distinct user roles are there?' },
  { aspect: 'auth', text: 'How should users sign in — email/password, Google login, or OTP?' },
  { aspect: 'payments', text: 'Does the application take payments?' },
  {
    aspect: 'integrations',
    text: 'Are integrations needed — email, SMS, file uploads, real-time updates?',
  },
];
