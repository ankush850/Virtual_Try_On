'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { JewelleryKind, ProductStatus } from '@vj/shared';
import type { CategoryDto, ProductDetailDto, ProductListItemDto } from '@vj/types';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  formatPrice,
} from '@vj/ui';
import { Sparkles, Edit, Plus } from 'lucide-react';
import { api } from '@/lib/api';

export interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: ProductDetailDto | ProductListItemDto | null;
  categories: CategoryDto[];
}

export function ProductFormDialog({
  open,
  onOpenChange,
  initialData,
  categories,
}: ProductFormDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState<JewelleryKind>(JewelleryKind.EARRINGS);
  const [status, setStatus] = useState<ProductStatus>(ProductStatus.PUBLISHED);
  const [priceCents, setPriceCents] = useState('7500000');
  const [currency, setCurrency] = useState('INR');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setSku(initialData.sku);
      setSlug(initialData.slug);
      setCategoryId(initialData.category?.id ?? '');
      setKind(initialData.jewelleryKind);
      setStatus(initialData.status);
      setPriceCents(initialData.priceCents?.toString() ?? '0');
      setCurrency(initialData.currency ?? 'INR');
      setDescription((initialData as ProductDetailDto).description ?? '');
    } else {
      setName('');
      setSku('');
      setSlug('');
      setCategoryId(categories[0]?.id ?? '');
      setKind(JewelleryKind.EARRINGS);
      setStatus(ProductStatus.PUBLISHED);
      setPriceCents('7500000');
      setCurrency('INR');
      setDescription('');
    }
  }, [initialData, categories, open]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Piece name is required');
      if (!sku.trim()) throw new Error('SKU code is required');
      if (!categoryId) throw new Error('Please select a collection category');

      const parsedPrice = parseInt(priceCents, 10);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        throw new Error('Price must be a valid non-negative number');
      }

      if (isEditing && initialData) {
        return api.admin.updateProduct(initialData.id, {
          name: name.trim(),
          sku: sku.trim(),
          slug: slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          categoryId,
          jewelleryKind: kind,
          status,
          priceCents: parsedPrice,
          currency: currency.toUpperCase(),
          description: description.trim() || undefined,
        });
      } else {
        return api.admin.createProduct({
          name: name.trim(),
          sku: sku.trim(),
          slug: slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          categoryId,
          jewelleryKind: kind,
          status,
          priceCents: parsedPrice,
          currency: currency.toUpperCase(),
          description: description.trim() || undefined,
        });
      }
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Piece updated successfully' : 'Piece created and registered in showroom');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Operation failed');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-3xl p-6 border border-primary/20 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-primary font-semibold">
            {isEditing ? <Edit className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            <span>{isEditing ? 'Update Piece' : 'New Showroom Piece'}</span>
          </div>
          <DialogTitle className="font-serif text-2xl font-light">
            {isEditing ? `Edit: ${initialData?.name}` : 'Add New Piece'}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="space-y-4 pt-2"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="prodName" className="text-xs uppercase tracking-wider text-muted-foreground">
                Piece Name *
              </Label>
              <Input
                id="prodName"
                placeholder="e.g. Royal Emerald Pendant"
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
              <Label htmlFor="prodSku" className="text-xs uppercase tracking-wider text-muted-foreground">
                SKU Code *
              </Label>
              <Input
                id="prodSku"
                placeholder="e.g. LUM-EAR-001"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="rounded-xl font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Jewellery Kind *
              </Label>
              <Select value={kind} onValueChange={(v) => setKind(v as JewelleryKind)}>
                <SelectTrigger className="rounded-xl text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(JewelleryKind).map((k) => (
                    <SelectItem key={k} value={k}>
                      {k.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Category *
              </Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="rounded-xl text-xs">
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <div className="flex justify-between items-center">
                <Label htmlFor="prodPrice" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Price in Cents *
                </Label>
                {priceCents && !isNaN(parseInt(priceCents, 10)) ? (
                  <span className="text-[11px] font-serif font-semibold text-primary">
                    {formatPrice(parseInt(priceCents, 10), currency)}
                  </span>
                ) : null}
              </div>
              <Input
                id="prodPrice"
                type="number"
                min="0"
                required
                value={priceCents}
                onChange={(e) => setPriceCents(e.target.value)}
                className="rounded-xl font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProductStatus)}>
                <SelectTrigger className="rounded-xl text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ProductStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prodDesc" className="text-xs uppercase tracking-wider text-muted-foreground">
              Description & Specifications
            </Label>
            <Textarea
              id="prodDesc"
              placeholder="18K Yellow Gold with brilliant-cut diamonds, handcrafted by master artisans…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-xl text-xs min-h-[70px]"
            />
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">
              Cancel
            </Button>
            <Button type="submit" disabled={submitMutation.isPending} className="rounded-full px-6">
              {submitMutation.isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Piece'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
