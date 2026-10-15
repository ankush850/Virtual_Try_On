'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderTree, Trash2, Edit } from 'lucide-react';
import { AdminShell } from '@/components/layout/admin-shell';
import {
  Button,
  Card,
  CardContent,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
  EmptyState,
  toast,
} from '@vj/ui';
import { api } from '@/lib/api';
import type { CategoryDto } from '@vj/types';
import { CategoryFormDialog } from '@/components/categories/category-form-dialog';

export default function AdminCategoriesPage() {
  const queryClient = useQueryClient();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryDto | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Load categories
  const categoriesQuery = useQuery({
    queryKey: ['admin', 'categories', 'full'],
    queryFn: () => api.catalog.listCategories({ flat: true }),
  });

  // Delete Category Mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.admin.deleteCategory(id),
    onSuccess: () => {
      toast.success('Category removed from taxonomy');
      setDeleteConfirmId(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
    },
    onError: () => toast.error('Could not delete category'),
  });

  const handleEdit = (category: CategoryDto) => {
    setSelectedCategory(category);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setSelectedCategory(null);
    setIsFormOpen(true);
  };

  const categories = categoriesQuery.data ?? [];

  return (
    <AdminShell title="Category & Collection Management">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-light text-foreground">Collection Taxonomy</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Organize jewellery categories, hierarchies, and navigation links for customer discovery.
            </p>
          </div>

          <Button onClick={handleCreate} className="rounded-full gap-2 shadow-sm self-start sm:self-auto text-xs">
            <Plus className="h-4 w-4" /> Add Category
          </Button>
        </div>

        {/* Categories Table */}
        <Card className="rounded-3xl border overflow-hidden shadow-xs">
          <CardContent className="p-0">
            {categoriesQuery.isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <EmptyState
                title="No categories registered"
                description="Create your first fine jewellery category (e.g. Earrings, Necklaces, Solitaires)."
                action={
                  <Button onClick={handleCreate} className="rounded-full">
                    Create Category
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Category Name</TableHead>
                    <TableHead className="text-xs">Slug</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs">Sort Order</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-xs">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FolderTree className="h-4 w-4" />
                          </div>
                          <span className="font-semibold text-foreground text-sm">{c.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{c.slug}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {c.description || '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{c.sortOrder}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={c.isActive ? 'border-emerald-500/40 text-emerald-500 text-[10px]' : 'text-muted-foreground text-[10px]'}
                        >
                          {c.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(c)}
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                            title="Edit Category"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteConfirmId(c.id)}
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                            title="Delete Category"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add / Edit Category Dialog */}
        <CategoryFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          initialData={selectedCategory}
        />

        {/* Delete Confirmation Dialog */}
        {deleteConfirmId && (
          <Dialog open={Boolean(deleteConfirmId)} onOpenChange={() => setDeleteConfirmId(null)}>
            <DialogContent className="max-w-md rounded-3xl p-6 border border-destructive/20 bg-card">
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Delete Category</DialogTitle>
                <DialogDescription className="text-xs">
                  Are you sure you want to delete this category? Pieces linked to this category may need reassignment.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="pt-4">
                <Button variant="ghost" onClick={() => setDeleteConfirmId(null)} className="rounded-full">
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate(deleteConfirmId)}
                  disabled={deleteMutation.isPending}
                  className="rounded-full"
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete Category'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </AdminShell>
  );
}
