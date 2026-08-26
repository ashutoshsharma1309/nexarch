import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { DropdownMenu } from '@/shared/components/ui/dropdown-menu';
import { queryClient } from '@/shared/services/query-client';
import { logout } from '@/shared/services/auth.service';
import { useAuthStore } from '@/shared/store/auth.store';
import { toast } from '@/shared/store/toast.store';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const navigate = useNavigate();

  const signOut = useMutation({
    mutationFn: logout,
    // Whether or not the request succeeded, this browser is done with the
    // session: drop the local state either way rather than stranding a user
    // in a half-signed-out console.
    onSettled: () => {
      clear();
      queryClient.clear();
      void navigate('/login', { replace: true });
    },
    onError: () => {
      toast('Signed out locally — the server could not be reached', 'error');
    },
  });

  if (!user) return null;

  return (
    <DropdownMenu
      trigger={
        <span
          className="flex size-7 items-center justify-center rounded-full border border-line bg-raised font-mono text-2xs text-fg-muted"
          title={`${user.name} · ${user.email}`}
        >
          {initials(user.name)}
        </span>
      }
      items={[
        { label: user.email, onSelect: () => undefined },
        {
          label: 'Settings',
          onSelect: () => {
            void navigate('/settings');
          },
        },
        {
          label: signOut.isPending ? 'Signing out…' : 'Sign out',
          destructive: true,
          onSelect: () => {
            signOut.mutate();
          },
        },
      ]}
    />
  );
}
