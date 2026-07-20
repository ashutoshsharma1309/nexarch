/**
 * Emits the pages every generated app has regardless of domain: Dashboard
 * (stat cards over the implemented entities), Login/Register (only when
 * auth is present), Settings, Profile, and the 404 catch-all.
 */
import type { FrontendProjectModel } from './project-model.js';
import type { GeneratedFile } from '../frontend-generator.types.js';
import { file } from './file-tree.js';

const MAX_DASHBOARD_STATS = 6;

function dashboardPage(model: FrontendProjectModel): string {
  const stats = model.pages.filter((p) => p.implemented).slice(0, MAX_DASHBOARD_STATS);

  if (stats.length === 0) {
    return `import { LayoutDashboard } from 'lucide-react';

import { PageHeader } from '@/shared/components/page-header';
import { EmptyState } from '@/shared/components/ui/empty-state';

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Overview" description="Your workspace at a glance." />
      <EmptyState
        icon={<LayoutDashboard className="size-4" />}
        title="No live modules yet"
        description="Stats appear here once the backend implements at least one module."
      />
    </>
  );
}
`;
  }

  const imports = stats
    .map((p) => `import { use${p.name}List } from '@/features/${p.slug}/hooks/use-${p.slug}';`)
    .join('\n');
  const hookCalls = stats
    .map(
      (p) =>
        `  const ${p.slug.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}Stat = use${p.name}List({ limit: 1 });`,
    )
    .join('\n');
  const cards = stats
    .map((p) => {
      const varName = p.slug.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      return `        <StatCard
          label="${p.navLabel}"
          value={String(${varName}Stat.data?.meta.pagination?.total ?? 0)}
          hint="Total records"
          loading={${varName}Stat.isPending}
        />`;
    })
    .join('\n');

  return `import { StatCard } from '@/shared/components/ui/stat-card';
import { PageHeader } from '@/shared/components/page-header';
${imports}

export function DashboardPage() {
${hookCalls}

  return (
    <>
      <PageHeader title="Overview" description="Your workspace at a glance." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
${cards}
      </div>
    </>
  );
}
`;
}

const loginPage = `import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useLogin } from '@/features/auth/hooks/use-auth';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-fg">Sign in</h1>
      <p className="mb-6 text-xs text-fg-muted">Welcome back — enter your details below.</p>
      <form
        onSubmit={(event) => {
          void handleSubmit((values) => login.mutate(values))(event);
        }}
        noValidate
        className="space-y-4"
      >
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" invalid={Boolean(errors.password)} {...register('password')} />
          {errors.password && <p className="mt-1 text-xs text-danger">{errors.password.message}</p>}
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-fg-muted">
        No account?{' '}
        <Link to="/register" className="text-accent hover:text-accent-hover">
          Create one
        </Link>
      </p>
    </>
  );
}
`;

const registerPage = `import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useRegister } from '@/features/auth/hooks/use-auth';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
});

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const register_ = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-fg">Create an account</h1>
      <p className="mb-6 text-xs text-fg-muted">Start by telling us who you are.</p>
      <form
        onSubmit={(event) => {
          void handleSubmit((values) => register_.mutate(values))(event);
        }}
        noValidate
        className="space-y-4"
      >
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" invalid={Boolean(errors.password)} {...register('password')} />
          {errors.password && <p className="mt-1 text-xs text-danger">{errors.password.message}</p>}
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={register_.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-fg-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:text-accent-hover">
          Sign in
        </Link>
      </p>
    </>
  );
}
`;

function settingsPage(authEnabled: boolean): string {
  const profileTab = authEnabled
    ? `      {tab === 'profile' && (
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            {user && <Avatar name={user.name} className="size-12 text-sm" />}
            <div>
              <p className="text-sm font-medium text-fg">{user?.name ?? 'Signed out'}</p>
              <p className="text-xs text-fg-muted">{user?.email}</p>
            </div>
          </CardContent>
        </Card>
      )}`
    : `      {tab === 'profile' && (
        <Card>
          <CardContent className="py-5 text-xs text-fg-muted">No authenticated user in this build.</CardContent>
        </Card>
      )}`;

  const imports = [
    "import { useState } from 'react';",
    '',
    "import { cn } from '@/shared/lib/cn';",
    "import { Card, CardContent } from '@/shared/components/ui/card';",
    "import { Input } from '@/shared/components/ui/input';",
    "import { Label } from '@/shared/components/ui/label';",
    "import { Button } from '@/shared/components/ui/button';",
    authEnabled ? "import { Avatar } from '@/shared/components/ui/avatar';" : null,
    "import { PageHeader } from '@/shared/components/page-header';",
    "import { SettingsLayout } from '@/shared/layouts/settings-layout';",
    "import { useSettingsStore } from '@/shared/store/settings.store';",
    "import { useThemeStore } from '@/shared/store/theme.store';",
    authEnabled ? "import { useAuthStore } from '@/shared/store/auth.store';" : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return `${imports}

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'appearance', label: 'Appearance' },
];

export function SettingsPage() {
  const [tab, setTab] = useState('profile');
  const workspaceName = useSettingsStore((state) => state.workspaceName);
  const setWorkspaceName = useSettingsStore((state) => state.setWorkspaceName);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  ${authEnabled ? 'const user = useAuthStore((state) => state.user);' : ''}
  const [nameDraft, setNameDraft] = useState(workspaceName);

  return (
    <>
      <PageHeader title="Settings" description="Workspace and appearance preferences." />
      <SettingsLayout tabs={TABS} active={tab} onChange={setTab}>
${profileTab}
        {tab === 'workspace' && (
          <Card>
            <CardContent className="space-y-3 py-5">
              <div className="max-w-xs">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input
                  id="workspace-name"
                  value={nameDraft}
                  onChange={(event) => { setNameDraft(event.target.value); }}
                />
              </div>
              <Button
                variant="primary"
                disabled={nameDraft.trim() === workspaceName}
                onClick={() => { setWorkspaceName(nameDraft.trim()); }}
              >
                Save changes
              </Button>
            </CardContent>
          </Card>
        )}
        {tab === 'appearance' && (
          <Card>
            <CardContent className="flex gap-3 py-5">
              {(['dark', 'light'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { setTheme(option); }}
                  className={cn(
                    'flex-1 max-w-40 rounded-md border px-4 py-3 text-left capitalize transition-colors',
                    theme === option ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                  )}
                >
                  {option}
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </SettingsLayout>
    </>
  );
}
`;
}

const profilePage = `import { LogOut } from 'lucide-react';

import { PageHeader } from '@/shared/components/page-header';
import { Avatar } from '@/shared/components/ui/avatar';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { useAuthStore } from '@/shared/store/auth.store';

export function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  if (!user) {
    return (
      <>
        <PageHeader title="Profile" />
        <p className="text-xs text-fg-muted">Sign in to view your profile.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" description="Your account details." />
      <Card>
        <CardContent className="flex items-center justify-between py-5">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} className="size-12 text-sm" />
            <div>
              <p className="text-sm font-medium text-fg">{user.name}</p>
              <p className="text-xs text-fg-muted">{user.email}</p>
              <div className="mt-1.5 flex gap-1.5">
                {user.roles.map((role) => (
                  <Badge key={role} variant="accent">{role}</Badge>
                ))}
              </div>
            </div>
          </div>
          <Button variant="secondary" icon={<LogOut className="size-3.5" />} onClick={logout}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
`;

const notFoundPage = `import { useNavigate } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="font-mono text-6xl font-semibold tracking-tight text-fg">404</h1>
      <p className="mt-4 max-w-sm text-[0.8125rem] text-fg-muted">
        This page doesn't exist. If a link brought you here, it's pointing at something that moved.
      </p>
      <Button
        variant="primary"
        className="mt-8"
        onClick={() => { void navigate('/'); }}
      >
        Back to dashboard
      </Button>
    </div>
  );
}
`;

export function emitFixedPages(model: FrontendProjectModel): GeneratedFile[] {
  const files: GeneratedFile[] = [
    file('src/features/dashboard/DashboardPage.tsx', 'typescriptreact', dashboardPage(model)),
    file(
      'src/features/settings/SettingsPage.tsx',
      'typescriptreact',
      settingsPage(model.authEnabled),
    ),
    file('src/app/NotFoundPage.tsx', 'typescriptreact', notFoundPage),
  ];

  if (model.authEnabled) {
    files.push(
      file('src/features/auth/LoginPage.tsx', 'typescriptreact', loginPage),
      file('src/features/auth/RegisterPage.tsx', 'typescriptreact', registerPage),
      file('src/features/profile/ProfilePage.tsx', 'typescriptreact', profilePage),
    );
  }

  return files;
}
