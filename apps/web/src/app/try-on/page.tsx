'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@vj/api-client';
import { Button, PageLoader, EmptyState } from '@vj/ui';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { TryOnExperience } from '@/features/try-on/TryOnExperience';
import {
  cacheCatalogue,
  getCachedOrFallbackCatalogue,
  getProductFromCacheOrFallback,
} from '@/features/try-on/offline-catalog';

export default function TryOnStudioHubPage() {
  const productsQuery = useQuery({
    queryKey: queryKeys.products.list({ pageSize: 12 }),
    queryFn: async () => {
      try {
        const res = await api.catalog.listProducts({ pageSize: 12 });
        cacheCatalogue(res.items);
        return res;
      } catch {
        const fallback = getCachedOrFallbackCatalogue();
        return {
          items: fallback,
          total: fallback.length,
          page: 1,
          pageSize: fallback.length,
          totalPages: 1,
        };
      }
    },
  });

  const featured = productsQuery.data?.items[0];

  const productDetailQuery = useQuery({
    queryKey: queryKeys.products.detail(featured?.id ?? ''),
    queryFn: async () => {
      try {
        return await api.catalog.getProduct(featured!.id);
      } catch {
        const fallback = getProductFromCacheOrFallback(featured!.id);
        if (fallback) return fallback;
        throw new Error('Product not found in catalogue');
      }
    },
    enabled: Boolean(featured?.id),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-4 py-4 sm:px-6 bg-card/60 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="rounded-full">
            <Link href="/products">
              <ArrowLeft className="mr-2 h-4 w-4" /> Exit Studio
            </Link>
          </Button>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-primary font-semibold">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Virtual Fitting Studio</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground hidden sm:block">
          Select any piece to preview live on your camera
        </p>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {productsQuery.isLoading || productDetailQuery.isLoading ? (
          <PageLoader label="Opening Virtual Studio…" />
        ) : productDetailQuery.data ? (
          <TryOnExperience
            product={productDetailQuery.data}
            alternativeProducts={productsQuery.data?.items}
          />
        ) : (
          <EmptyState
            title="No pieces available for try-on"
            description="Our studio is currently updating the virtual collection. Please browse our catalogue."
            action={
              <Button asChild>
                <Link href="/products">Browse Catalogue</Link>
              </Button>
            }
          />
        )}
      </main>
    </div>
  );
}
