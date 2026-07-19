import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names with correct Tailwind conflict resolution
 * (`cn('p-2', condition && 'p-4')` keeps only `p-4` when true).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
