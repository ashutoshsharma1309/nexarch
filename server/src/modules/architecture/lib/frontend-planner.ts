/**
 * Frontend Planner: pages, layouts, navigation, dashboard widgets and the
 * reusable component kit. Pages map 1:1 to backend modules; widgets come
 * from a per-domain dictionary with a sensible fallback.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { kebabCase } from '../../../shared/utils/strings.js';
import type { FrontendPlan, PagePlan } from '../architecture.types.js';
import { dataModules, hasIntegration, hasModule } from './common.js';

const DOMAIN_WIDGETS: Readonly<Record<string, { name: string; description: string }[]>> = {
  Hospital: [
    { name: "Today's Appointments", description: 'Count and next slots for the day' },
    { name: 'Patients Admitted', description: 'Current in-care patients' },
    { name: 'Revenue This Month', description: 'Billing totals with trend' },
  ],
  Ecommerce: [
    { name: 'Orders Today', description: 'Order count and value for the day' },
    { name: 'Revenue', description: 'Rolling 30-day revenue with trend' },
    { name: 'Low Stock', description: 'Products under the reorder threshold' },
  ],
  School: [
    { name: 'Attendance Today', description: 'Present/absent across classes' },
    { name: 'Upcoming Exams', description: 'Next scheduled exams' },
    { name: 'Fees Outstanding', description: 'Unpaid fee totals' },
  ],
  Banking: [
    { name: 'Transactions Today', description: 'Volume and value processed' },
    { name: 'Pending Approvals', description: 'Transfers and loans awaiting review' },
    { name: 'Flagged Activity', description: 'Rule-triggered suspicious events' },
  ],
  Restaurant: [
    { name: 'Open Orders', description: 'Orders in the kitchen right now' },
    { name: 'Table Occupancy', description: 'Seated vs free tables' },
    { name: 'Sales Today', description: 'Covers and revenue for the day' },
  ],
  Hotel: [
    { name: 'Occupancy', description: 'Rooms occupied vs available tonight' },
    { name: 'Arrivals & Departures', description: 'Today’s check-ins/check-outs' },
    { name: 'Revenue This Month', description: 'Booking revenue with trend' },
  ],
};

export function planFrontend(spec: RequirementSpec): FrontendPlan {
  const modules = dataModules(spec);
  const allRoles = spec.roles;

  const pages: PagePlan[] = [
    { name: 'Login', route: '/login', layout: 'AuthLayout', access: ['Public'] },
    { name: 'Register', route: '/register', layout: 'AuthLayout', access: ['Public'] },
    { name: 'Dashboard', route: '/', layout: 'AppLayout', access: allRoles },
    ...modules.map((module) => ({
      name: module,
      route: `/${kebabCase(module)}`,
      layout: 'AppLayout' as const,
      access: allRoles,
    })),
  ];
  if (hasModule(spec, 'Reports') || hasModule(spec, 'Analytics')) {
    pages.push({ name: 'Reports', route: '/reports', layout: 'AppLayout', access: ['Admin'] });
  }
  pages.push(
    { name: 'Settings', route: '/settings', layout: 'AppLayout', access: ['Admin'] },
    { name: 'Not Found', route: '*', layout: 'AppLayout', access: ['Public'] },
  );

  const navigation = pages
    .filter((page) => page.layout === 'AppLayout' && page.route !== '*')
    .map((page) => ({ label: page.name, route: page.route, roles: page.access }));

  const widgets =
    DOMAIN_WIDGETS[spec.projectType] ??
    modules.slice(0, 3).map((module) => ({
      name: `Total ${module}`,
      description: `${module} count with 30-day trend`,
    }));

  const reusableComponents = [
    'DataTable (sortable, paginated)',
    'FormField (label + input + error)',
    'Modal / ConfirmDialog',
    'StatCard',
    'SearchInput',
    'StatusBadge',
    'EmptyState',
    'Skeleton loaders',
    'Toast notifications',
  ];
  if (modules.some((module) => ['Appointments', 'Bookings', 'Timetable'].includes(module))) {
    reusableComponents.push('Calendar / SlotPicker');
  }
  if (hasIntegration(spec, 'File Upload') || hasIntegration(spec, 'Cloud Storage')) {
    reusableComponents.push('FileUploader (drag & drop)');
  }
  if (hasIntegration(spec, 'Real-time')) {
    reusableComponents.push('LiveIndicator (socket connection state)');
  }
  if (hasModule(spec, 'Reports') || hasModule(spec, 'Analytics')) {
    reusableComponents.push('ChartPanel (line/bar)');
  }

  return {
    pages,
    layouts: ['AuthLayout (centered card)', 'AppLayout (sidebar + top bar + content)'],
    navigation,
    dashboardWidgets: widgets,
    reusableComponents,
  };
}
