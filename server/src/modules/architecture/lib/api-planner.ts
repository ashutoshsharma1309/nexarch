/**
 * API Planner: REST surface grouped by module. Data modules get a uniform
 * CRUD contract (list endpoints are paginated and filterable by default);
 * chrome modules (auth, reports, notifications) get their specialized
 * shapes. Everything is authenticated except login/register/webhooks.
 */
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import { kebabCase, singularize } from '../../../shared/utils/strings.js';
import type { ApiEndpoint, ApiModulePlan } from '../architecture.types.js';
import { dataModules, hasModule } from './common.js';

function authEndpoints(spec: RequirementSpec): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [
    { method: 'POST', path: '/auth/register', description: 'Create an account', auth: false },
    {
      method: 'POST',
      path: '/auth/login',
      description: 'Exchange credentials for tokens',
      auth: false,
    },
    { method: 'POST', path: '/auth/refresh', description: 'Rotate the refresh token', auth: false },
    { method: 'POST', path: '/auth/logout', description: 'Revoke the refresh token', auth: true },
    { method: 'GET', path: '/auth/me', description: 'Current user profile and role', auth: true },
  ];
  if (spec.authentication.includes('Forgot Password')) {
    endpoints.push(
      {
        method: 'POST',
        path: '/auth/forgot-password',
        description: 'Send a reset link',
        auth: false,
      },
      {
        method: 'POST',
        path: '/auth/reset-password',
        description: 'Set a new password from a reset token',
        auth: false,
      },
    );
  }
  if (spec.authentication.includes('OTP')) {
    endpoints.push({
      method: 'POST',
      path: '/auth/otp/verify',
      description: 'Verify a one-time password challenge',
      auth: false,
    });
  }
  return endpoints;
}

function crudEndpoints(module: string): ApiEndpoint[] {
  const slug = kebabCase(module);
  const singular = singularize(module).toLowerCase();
  return [
    {
      method: 'GET',
      path: `/${slug}`,
      description: `List ${module.toLowerCase()} (paginated, filterable)`,
      auth: true,
    },
    { method: 'GET', path: `/${slug}/:id`, description: `Fetch one ${singular}`, auth: true },
    { method: 'POST', path: `/${slug}`, description: `Create a ${singular}`, auth: true },
    { method: 'PUT', path: `/${slug}/:id`, description: `Update a ${singular}`, auth: true },
    {
      method: 'DELETE',
      path: `/${slug}/:id`,
      description: `Delete a ${singular}`,
      auth: true,
      roles: ['Admin'],
    },
  ];
}

/** Module-specific deviations from plain CRUD. */
function specializedEndpoints(module: string): ApiEndpoint[] | null {
  switch (module) {
    case 'Payments':
    case 'Billing':
      return [
        {
          method: 'POST',
          path: '/payments/checkout',
          description: 'Start a payment for an order/invoice',
          auth: true,
        },
        {
          method: 'POST',
          path: '/payments/webhook',
          description: 'Provider webhook (signature-verified)',
          auth: false,
        },
        { method: 'GET', path: '/payments', description: 'List payments (paginated)', auth: true },
        {
          method: 'GET',
          path: '/payments/:id',
          description: 'Payment status and receipt',
          auth: true,
        },
      ];
    case 'Chat':
    case 'Conversations':
      return [
        {
          method: 'GET',
          path: '/conversations',
          description: 'List conversations for the current user',
          auth: true,
        },
        { method: 'POST', path: '/conversations', description: 'Start a conversation', auth: true },
        {
          method: 'GET',
          path: '/conversations/:id/messages',
          description: 'Message history (paginated)',
          auth: true,
        },
        {
          method: 'POST',
          path: '/conversations/:id/messages',
          description: 'Send a message (also via socket)',
          auth: true,
        },
      ];
    default:
      return null;
  }
}

export function planApi(spec: RequirementSpec): ApiModulePlan[] {
  const plans: ApiModulePlan[] = [
    { module: 'Authentication', basePath: '/auth', endpoints: authEndpoints(spec) },
  ];

  for (const module of dataModules(spec)) {
    const specialized = specializedEndpoints(module);
    plans.push({
      module,
      basePath: `/${kebabCase(module)}`,
      endpoints: specialized ?? crudEndpoints(module),
    });
  }

  if (hasModule(spec, 'Reports') || hasModule(spec, 'Analytics')) {
    plans.push({
      module: 'Reports',
      basePath: '/reports',
      endpoints: [
        {
          method: 'GET',
          path: '/reports/summary',
          description: 'Aggregated dashboard metrics',
          auth: true,
        },
        {
          method: 'GET',
          path: '/reports/:type/export',
          description: 'Export a report (PDF/Excel)',
          auth: true,
          roles: ['Admin'],
        },
      ],
    });
  }

  if (hasModule(spec, 'Notifications')) {
    plans.push({
      module: 'Notifications',
      basePath: '/notifications',
      endpoints: [
        {
          method: 'GET',
          path: '/notifications',
          description: 'Current user notifications',
          auth: true,
        },
        {
          method: 'PATCH',
          path: '/notifications/:id/read',
          description: 'Mark as read',
          auth: true,
        },
      ],
    });
  }

  return plans;
}
