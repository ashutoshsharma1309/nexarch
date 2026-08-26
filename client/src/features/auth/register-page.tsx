import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';
import { queryClient } from '@/shared/services/query-client';
import { register as registerAccount } from '@/shared/services/auth.service';
import { useAuthStore } from '@/shared/store/auth.store';
import { toast } from '@/shared/store/toast.store';
import { AuthShell } from './auth-shell';
import { registerSchema } from './auth-schema';
import type { RegisterValues } from './auth-schema';

export function RegisterPage() {
  useDocumentTitle('Create account');
  const setUser = useAuthStore((state) => state.setUser);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
    mode: 'onBlur',
  });

  const signUp = useMutation({
    mutationFn: registerAccount,
    onSuccess: (user) => {
      queryClient.clear();
      toast(`Welcome, ${user.name.split(' ')[0] ?? user.name}`, 'success');
      // Registration signs you in; `RedirectIfAuthenticated` takes it from
      // here and lands a new account on the Forge.
      setUser(user);
    },
  });

  return (
    <AuthShell
      eyebrow="nexarch register"
      title="Create your account"
      description="Local account, stored in your own database. No third-party sign-in."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-fg underline underline-offset-2 hover:text-ember">
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            signUp.mutate(values);
          })(event);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            invalid={Boolean(form.formState.errors.name)}
            {...form.register('name')}
          />
          {form.formState.errors.name && (
            <p className="text-xs text-danger">{form.formState.errors.name.message}</p>
          )}
        </div>

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
            autoComplete="new-password"
            invalid={Boolean(form.formState.errors.password)}
            {...form.register('password')}
          />
          <p className="text-2xs text-fg-subtle">
            At least 10 characters, with an uppercase letter, a lowercase letter and a digit.
          </p>
          {form.formState.errors.password && (
            <p className="text-xs text-danger">{form.formState.errors.password.message}</p>
          )}
        </div>

        {signUp.isError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {signUp.error instanceof Error ? signUp.error.message : 'Could not create the account'}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={signUp.isPending}
          icon={<UserPlus className="size-4" />}
        >
          {signUp.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
