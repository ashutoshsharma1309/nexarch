import type { StatusTone } from '@/shared/components/ui/status-dot';
import type { ProjectStatus } from '@/shared/types/api';

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'warn' },
};
