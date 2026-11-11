import { useNavigate } from 'react-router-dom';

import { Button } from '@/shared/components/ui/button';
import { useDocumentTitle } from '@/shared/hooks/use-document-title';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-start py-16 md:py-24">
      <h1 className="text-display text-fg">Page not found</h1>
      <p className="mt-4 max-w-sm text-sm text-fg-muted">
        Nothing lives at this address. The link may be out of date, or the page may have moved.
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
