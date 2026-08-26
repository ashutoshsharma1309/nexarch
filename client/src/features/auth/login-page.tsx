import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, LogIn } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { queryClient } from '@/shared/services/query-client';
import { login } from '@/shared/services/auth.service';
import { useAuthStore } from '@/shared/store/auth.store';
import { AuthShell } from './auth-shell';
import { loginSchema } from './auth-schema';
import type { LoginValues } from './auth-schema';

export function LoginPage() {
  useDocumentTitle('Sign in');
  const setUser = useAuthStore((state) => state.setUser);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const signIn = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      // Anything cached under the previous (or no) session is not this
      // user's. Clear first, then flip the session — `RedirectIfAuthenticated`
      // reacts to that flip and routes to wherever the guard bounced them from.
      queryClient.clear();
      setUser(user);
    },
  });

  return (
    <AuthShell
      eyebrow="nexarch login"
      title="Sign in"
      description="NexArch keeps your generated projects and run sessions to your account."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="text-fg underline underline-offset-2 hover:text-ember">
            Create one
          </Link>
        </>
      }
    >
      <form
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            signIn.mutate(values);
          })(event);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            invalid={Boolean(form.formState.errors.email)}
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <p className="text-xs text-danger">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(form.formState.errors.password)}
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-danger">{form.formState.errors.password.message}</p>
          )}
        </div>

        {signIn.isError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {signIn.error instanceof Error ? signIn.error.message : 'Could not sign in'}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={signIn.isPending}
          icon={<LogIn className="size-4" />}
        >
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
