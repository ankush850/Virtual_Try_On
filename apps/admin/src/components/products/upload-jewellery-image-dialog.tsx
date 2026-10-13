'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProductListItemDto } from '@vj/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@vj/ui';
import { Upload, Image as ImageIcon, Sparkles, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

export interface UploadJewelleryImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductListItemDto[];
  defaultProductId?: string;
}

export function UploadJewelleryImageDialog({
  open,
  onOpenChange,
  products,
  defaultProductId,
}: UploadJewelleryImageDialogProps) {
  const queryClient = useQueryClient();

  const [selectedProductId, setSelectedProductId] = useState(defaultProductId ?? '');
  const [imageUrl, setImageUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [isPrimary, setIsPrimary] = useState(true);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const prodId = selectedProductId || defaultProductId;
      if (!prodId) throw new Error('Please select a piece from catalogue');
      if (!imageUrl.trim()) throw new Error('Please provide an image URL');

      // Update product primary image or metadata via updateProduct
      return api.admin.updateProduct(prodId, {
        metadata: {
          lastUploadedImage: {
            url: imageUrl.trim(),
            altText: altText.trim() || undefined,
            isPrimary,
            uploadedAt: new Date().toISOString(),
          },
        },
      });
    },
    onSuccess: () => {
      toast.success('Jewellery showroom image uploaded and bound to product');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
      setImageUrl('');
      setAltText('');
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not upload image');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl p-6 border border-primary/20 bg-card">
        <DialogHeader>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-primary font-semibold">
            <Upload className="h-3.5 w-3.5" />
            <span>Showroom Asset</span>
          </div>
          <DialogTitle className="font-serif text-2xl font-light">Upload Jewellery Image</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            uploadMutation.mutate();
          }}
          className="space-y-4 pt-2"
        >
          {/* Target Piece Selector */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Target Piece *
            </Label>
            <Select
              value={selectedProductId || defaultProductId || ''}
              onValueChange={setSelectedProductId}
            >
              <SelectTrigger className="rounded-xl text-xs">
                <SelectValue placeholder="Select jewellery item…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · SKU: {p.sku}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Image URL Input */}
          <div className="space-y-1.5">
            <Label htmlFor="imgUrl" className="text-xs uppercase tracking-wider text-muted-foreground">
              Image Storage / CDN URL *
            </Label>
            <Input
              id="imgUrl"
              placeholder="https://images.unsplash.com/... or cloud storage URL"
              required
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="rounded-xl font-mono text-xs"
            />
          </div>

          {/* Alt Text */}
          <div className="space-y-1.5">
            <Label htmlFor="imgAlt" className="text-xs uppercase tracking-wider text-muted-foreground">
              Alt Text / Description
            </Label>
            <Input
              id="imgAlt"
              placeholder="e.g. Front view of 18K Yellow Gold Diamond Earring"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              className="rounded-xl text-xs"
            />
          </div>

          {/* Primary image toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isPrimaryImg"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary cursor-pointer"
            />
            <Label htmlFor="isPrimaryImg" className="text-xs text-foreground cursor-pointer">
              Set as primary showroom showcase image
            </Label>
          </div>

          {/* Live Preview Box */}
          {imageUrl.trim() ? (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-black/5 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={altText || 'Preview'}
                className="h-full w-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-border/80 p-5 text-center bg-muted/20">
              <ImageIcon className="mx-auto h-7 w-7 text-muted-foreground/60" />
              <p className="mt-1 text-xs text-muted-foreground">
                Enter an image URL above to see real-time preview
              </p>
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">
              Cancel
            </Button>
            <Button type="submit" disabled={uploadMutation.isPending} className="rounded-full px-6">
              {uploadMutation.isPending ? 'Uploading…' : 'Attach Image to Piece'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
