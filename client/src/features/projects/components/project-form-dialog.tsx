import { useEffect, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Dialog } from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

export interface ProjectFormValues {
  name: string;
  description: string;
}

interface ProjectFormDialogProps {
  open: boolean;
  mode: 'create' | 'rename';
  initialValues?: ProjectFormValues;
  loading?: boolean;
  onSubmit: (values: ProjectFormValues) => void;
  onClose: () => void;
}

export function ProjectFormDialog({
  open,
  mode,
  initialValues,
  loading = false,
  onSubmit,
  onClose,
}: ProjectFormDialogProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');

  useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '');
      setDescription(initialValues?.description ?? '');
    }
  }, [open, initialValues]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'New project' : 'Rename project'}
      description={
        mode === 'create'
          ? 'Give this application a name — it becomes the container for its documentation and exports.'
          : undefined
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === '') return;
          onSubmit({ name: name.trim(), description: description.trim() });
        }}
        className="space-y-3"
      >
        <div>
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="e.g. Hospital Management System"
          />
        </div>
        <div>
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            rows={3}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            placeholder="Optional — shown on the project dashboard and in exported docs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={loading} disabled={name.trim() === ''}>
            {mode === 'create' ? 'Create project' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
