import { useNavigate } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="font-mono text-2xs tracking-widest text-fg-subtle uppercase">error/not-found</p>
      <h1 className="mt-3 font-mono text-6xl font-semibold tracking-tight text-fg">404</h1>
      <p className="mt-4 max-w-sm text-[0.8125rem] text-fg-muted">
        This route doesn&apos;t exist. If a link brought you here, it&apos;s pointing at something
        that moved or was never forged.
      </p>
      <div className="mt-8 flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            void navigate('/');
          }}
        >
          Back to home
        </Button>
        <Button
          onClick={() => {
            void navigate('/projects');
          }}
        >
          Your projects
        </Button>
      </div>
    </div>
  );
}
