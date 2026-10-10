'use client';

import { useId, type ReactNode } from 'react';
import type { ApiItem } from '@/types/api';
import BaseModal from '@/components/BaseModal';
import Badge from '@/components/Badge';
import Cover, { CoverMonogram } from '@/components/Cover';
import Icon from '@/components/Icon';
import type { StatusMeta } from '@/lib/utils/itemStatus';
import { linkDomain } from '@/lib/utils/itemFields';
import RelatedItemChips from '@/components/RelatedItemChips';
import type { ItemRef } from '@/lib/utils/itemLinks';

/**
 * An item's details (WIS-258): a bottom sheet on a phone and a dialog from
 * `sm` up, opened from the body of its card. It shows what the card has to cut
 * short (the full name and notes, a large photo) and the shop link with its
 * domain, over the card's own actions (`actions`, which the card builds from
 * `itemCardActions`, so the two never offer different things).
 *
 * The card renders it with the live item, so a poll's update shows here too,
 * and it goes with the card when the item is deleted. It's told the status as
 * the viewer sees it (`statusMeta`): an owner's never says an item is
 * reserved, and nothing here names a proposer.
 */
export default function ItemSheet({
  item,
  isOpen,
  onClose,
  status,
  price,
  originalPrice,
  actions,
  related = [],
  onShowItem,
  groupGift,
}: {
  item: ApiItem;
  isOpen: boolean;
  onClose: () => void;
  status: StatusMeta;
  /** The price as the card shows it (converted, "≈ €247", or exact). */
  price: string | null;
  /** The item's own price, under a converted one. */
  originalPrice: string | null;
  /** The card's actions: its primary and its "More actions" menu. */
  actions: ReactNode;
  /** "Goes with" (WIS-29): every partner the card was given, each going to it. */
  related?: readonly ItemRef[];
  onShowItem?: (itemId: string) => void;
  /** A member's group gift on the item (WIS-362), with its contributors. */
  groupGift?: ReactNode;
}) {
  const titleId = useId();
  const domain = linkDomain(item.link);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={item.name}
      titleId={titleId}
      closeLabel="Close"
      variant="sheet"
      footer={actions ? <div className="flex w-full items-center gap-2">{actions}</div> : undefined}
    >
      <div className="space-y-4">
        <div className="relative mx-auto aspect-square w-full max-w-[min(100%,45dvh)]">
          <Cover
            src={item.imageUrl}
            seed={item._id}
            name={item.name}
            placeholder={<CoverMonogram name={item.name} className="text-6xl" />}
            alt={item.name}
            sizes="(max-width: 640px) 100vw, 32rem"
            className="relative block h-full w-full overflow-hidden rounded-2xl bg-surface-2"
          />
          {(item.mostWanted || status.badge) && (
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5">
              {status.badge && <Badge status={status} className="shadow-sm" />}
              {item.mostWanted && (
                <Badge className="shadow-sm">
                  <Icon name="star" size={12} className="fill-star text-star-edge" />
                  Most wanted
                </Badge>
              )}
            </div>
          )}
        </div>

        {price && (
          <div>
            <p className="text-xl font-semibold text-foreground">{price}</p>
            {originalPrice && <p className="text-xs text-muted-foreground">{originalPrice}</p>}
          </div>
        )}

        {groupGift}

        {item.notes && (
          <p className="whitespace-pre-wrap break-words text-body text-foreground">{item.notes}</p>
        )}

        <RelatedItemChips items={related} onShow={onShowItem} />

        {/* Only an http(s) link is offered (`linkDomain`), in a new tab. */}
        {domain && item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open product page on ${domain}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-accent hover:underline"
          >
            <span className="truncate">{domain}</span>
            <Icon name="external-link" size={16} className="flex-shrink-0" />
          </a>
        )}
      </div>
    </BaseModal>
  );
}
