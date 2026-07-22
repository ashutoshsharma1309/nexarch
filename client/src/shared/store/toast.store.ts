import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, variant = 'info') => {
    const toastItem: Toast = { id: crypto.randomUUID(), message, variant };
    set((state) => ({ toasts: [...state.toasts, toastItem] }));
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience accessor for use outside components (e.g. mutation error handlers). */
export function toast(message: string, variant: ToastVariant = 'info'): void {
  useToastStore.getState().push(message, variant);
}
