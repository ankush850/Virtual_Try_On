'use client';

import { useRef } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { formatPrice } from '@vj/ui';
import type { JewelleryKind } from '@vj/shared';

export interface TryOnSelectorPiece {
  id: string;
  name: string;
  jewelleryKind: JewelleryKind;
  priceCents?: number | null;
  currency?: string | null;
  primaryImage?: { url: string; altText?: string | null } | null;
  imageUrl?: string;
}

export interface TryOnJewellerySelectorProps {
  items: TryOnSelectorPiece[];
  selectedId: string;
  onSelect: (item: TryOnSelectorPiece) => void;
  className?: string;
}

export function TryOnJewellerySelector({
  items,
  selectedId,
  onSelect,
  className,
}: TryOnJewellerySelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className={`w-full rounded-2xl border bg-card/90 backdrop-blur-md p-3 shadow-lg ${className ?? ''}`}>
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Switch Piece in Studio</span>
        </div>
        <span className="text-[11px] text-muted-foreground font-mono">{items.length} pieces</span>
      </div>

      <div
        ref={scrollRef}
        className="flex items-center gap-2.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin scrollbar-thumb-muted-foreground/20"
      >
        {items.map((item) => {
          const isSelected = selectedId === item.id;
          const image = item.primaryImage?.url || item.imageUrl;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={`group relative flex shrink-0 items-center gap-2.5 rounded-xl border p-1.5 transition-all duration-200 text-left select-none ${
                isSelected
                  ? 'border-primary bg-primary/10 shadow-sm ring-2 ring-primary/30'
                  : 'border-border/70 bg-background/80 hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-muted shrink-0">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt={item.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    ✦
                  </div>
                )}
                {isSelected ? (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <Check className="h-4 w-4 text-primary font-bold drop-shadow" />
                  </div>
                ) : null}
              </div>

              <div className="pr-2 max-w-[130px]">
                <p className="text-xs font-medium truncate text-foreground leading-tight group-hover:text-primary transition-colors">
                  {item.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono truncate">
                    {item.jewelleryKind.replace(/_/g, ' ')}
                  </span>
                  {item.priceCents != null ? (
                    <span className="text-[11px] font-semibold text-primary shrink-0">
                      {formatPrice(item.priceCents, item.currency ?? 'INR')}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
