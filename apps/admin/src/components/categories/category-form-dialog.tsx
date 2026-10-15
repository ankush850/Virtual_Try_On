'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CategoryDto } from '@vj/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Textarea,
  toast,
} from '@vj/ui';
import { Sparkles, Edit, Plus } from 'lucide-react';
import { api } from '@/lib/api';

export interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: CategoryDto | null;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  initialData,
}: CategoryFormDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setSlug(initialData.slug);
      setDescription(initialData.description ?? '');
      setSortOrder(initialData.sortOrder?.toString() ?? '0');
      setIsActive(initialData.isActive);
    } else {
      setName('');
      setSlug('');
      setDescription('');
      setSortOrder('0');
      setIsActive(true);
    }
  }, [initialData, open]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Category name is required');
      const order = parseInt(sortOrder, 10);
      if (isNaN(order)) throw new Error('Sort order must be an integer');

      if (isEditing && initialData) {
        return api.admin.updateCategory(initialData.id, {
          name: name.trim(),
          slug: slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          description: description.trim() || undefined,
          sortOrder: order,
          isActive,
        });
      } else {
        return api.admin.createCategory({
          name: name.trim(),
          slug: slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          description: description.trim() || undefined,
          sortOrder: order,
          isActive,
        });
      }
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Category updated successfully' : 'Collection category created');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Category operation failed');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6 border border-primary/20 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-primary font-semibold">
            {isEditing ? <Edit className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            <span>{isEditing ? 'Update Taxonomy' : 'New Collection Category'}</span>
          </div>
          <DialogTitle className="font-serif text-2xl font-light">
            {isEditing ? `Edit: ${initialData?.name}` : 'Create Category'}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="space-y-4 pt-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="catName" className="text-xs uppercase tracking-wider text-muted-foreground">
              Category Name *
            </Label>
            <Input
              id="catName"
              placeholder="e.g. Royal Solitaires"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!isEditing && !slug) {
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                }
              }}
              className="rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="catSlug" className="text-xs uppercase tracking-wider text-muted-foreground">
              URL Slug *
            </Label>
            <Input
              id="catSlug"
              placeholder="e.g. royal-solitaires"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="rounded-xl font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="catDesc" className="text-xs uppercase tracking-wider text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="catDesc"
              placeholder="Editorial description of this collection grouping…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-xl text-xs min-h-[70px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="catSort" className="text-xs uppercase tracking-wider text-muted-foreground">
                Display Order Priority
              </Label>
              <Input
                id="catSort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="rounded-xl font-mono text-xs"
              />
            </div>

            <div className="flex flex-col justify-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span className="font-medium text-foreground">Active in Storefront</span>
              </label>
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">
              Cancel
            </Button>
            <Button type="submit" disabled={submitMutation.isPending} className="rounded-full px-6">
              {submitMutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
