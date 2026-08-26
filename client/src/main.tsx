import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { setUnauthorizedHandler } from '@/shared/services/api-client';
import { queryClient } from '@/shared/services/query-client';
import { useAuthStore } from '@/shared/store/auth.store';
import { router } from './app/router';

import '@/shared/styles/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// A 401 anywhere means the cookie is gone or expired; drop the local
// session so the route guard bounces to /login instead of the app sitting
// on a dead session retrying failing queries.
setUnauthorizedHandler(() => {
  useAuthStore.getState().clear();
  queryClient.clear();
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
