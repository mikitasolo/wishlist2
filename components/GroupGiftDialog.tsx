'use client';

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import BaseModal from '@/components/BaseModal';
import Button from '@/components/Button';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { currencySymbol, formatPriceInput, parsePriceInput } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { GROUP_GIFT_MAX_CENTS } from '@/lib/utils/groupGiftSummary';

export type GroupGiftDialogMode = 'start' | 'join' | 'pledge';

export interface GroupGiftDialogResult {
  pledged: number;
  /** A start only: the target, when it isn't the item's own price. */
  target?: { value: number; currency: string };
}

const COPY: Record<GroupGiftDialogMode, { title: string; submit: string; intro: string }> = {
  start: {
    title: 'Start a group gift',
    submit: 'Start group gift',
    intro:
      'Split this item with others on the list. Pledges are a promise between you, nobody pays through the app.',
  },
  join: {
    title: 'Join the group gift',
    submit: 'Join',
    intro: 'Say how much you plan to chip in. Pledges are a promise, nobody pays through the app.',
  },
  pledge: {
    title: 'Change your pledge',
    submit: 'Save pledge',
    intro: 'The others in the group gift see the new amount.',
  },
};

/**
 * What a group gift asks a member (WIS-362): their pledge, and when starting
 * one, the target (the item's price unless they change it; an item with no
 * price needs one). The dialog closes as it submits: the card shows the result
 * at once and says so if the server refuses.
 *
 * `currency` is the one the amounts are in: the gift's own when it's known (a
 * pledge change), else the item's price's, else the member picks one.
 */
export default function GroupGiftDialog({
  mode,
  itemName,
  price,
  currency,
  pledged,
  onSubmit,
  onClose,
}: {
  mode: GroupGiftDialogMode;
  itemName: string;
  /** The item's price, which a new group gift's target starts at. */
  price?: { value: number; currency: string } | null;
  /** Fixed currency of the amounts, when known. */
  currency?: string;
  /** The current pledge, in a pledge change. */
  pledged?: number;
  onSubmit: (result: GroupGiftDialogResult) => void;
  onClose: () => void;
}) {
  const locale = useViewerLocale();
  const titleId = useId();
  const copy = COPY[mode];
  const picksCurrency = mode === 'start' && !price && !currency;
  const [pickedCurrency, setPickedCurrency] = useState(currency ?? price?.currency ?? 'USD');
  const code = picksCurrency ? pickedCurrency : (currency ?? price?.currency ?? pickedCurrency);
  const [target, setTarget] = useState(price ? formatPriceInput(price.value, code, locale) : '');
  const [pledge, setPledge] = useState(pledged ? formatPriceInput(pledged, code, locale) : '');
  const [shown, setShown] = useState(false);
  const pledgeRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  const hints = useMemo(
    () => ({
      symbol: currencySymbol(code, locale),
      example: formatPriceInput(5000, code, locale),
    }),
    [code, locale]
  );

  const pledgeCents = parsePriceInput(pledge, locale);
  const targetCents = parsePriceInput(target, locale);
  const amountOk = (r: ReturnType<typeof parsePriceInput>) =>
    r.ok && r.cents !== null && r.cents >= 1 && r.cents <= GROUP_GIFT_MAX_CENTS;
  const pledgeError = amountOk(pledgeCents) ? null : `Enter an amount like ${hints.example}`;
  const targetNeeded = mode === 'start';
  const targetError = !targetNeeded || amountOk(targetCents) ? null : 'Enter the full price';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (targetError) return targetRef.current?.focus();
    if (pledgeError) return pledgeRef.current?.focus();
    const result: GroupGiftDialogResult = { pledged: pledgeCents.ok ? pledgeCents.cents! : 0 };
    if (mode === 'start' && targetCents.ok && targetCents.cents !== null) {
      // Sent only when it isn't what the server would take (the item's price).
      const same = price && price.value === targetCents.cents && price.currency === code;
      if (!same) result.target = { value: targetCents.cents, currency: code };
    }
    onSubmit(result);
    onClose();
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={copy.title}
      titleId={titleId}
      size="md"
      onSubmit={handleSubmit}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{copy.submit}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-body text-muted-foreground">
          <span className="font-medium text-foreground">{itemName}</span>. {copy.intro}
        </p>
        {mode === 'start' && (
          <Field
            label="Target"
            id="group-gift-target"
            helper={price ? "Starts at the item's price." : 'What the whole gift costs.'}
            error={shown ? (targetError ?? undefined) : undefined}
          >
            <div className="flex gap-2">
              <Input
                ref={targetRef}
                inputMode="decimal"
                leading={<span aria-hidden="true">{hints.symbol}</span>}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="min-w-0 flex-1"
                autoComplete="off"
              />
              {picksCurrency && (
                <Select
                  ariaLabel="Currency"
                  size="lg"
                  value={pickedCurrency}
                  onChange={setPickedCurrency}
                  options={currencySelectOptions}
                  valueLabel={pickedCurrency}
                  triggerClassName="w-28 flex-shrink-0"
                />
              )}
            </div>
          </Field>
        )}
        <Field
          label="Your pledge"
          id="group-gift-pledge"
          error={shown ? (pledgeError ?? undefined) : undefined}
        >
          <Input
            ref={pledgeRef}
            inputMode="decimal"
            leading={<span aria-hidden="true">{hints.symbol}</span>}
            value={pledge}
            onChange={(e) => setPledge(e.target.value)}
            placeholder={hints.example}
            autoComplete="off"
            autoFocus
          />
        </Field>
      </div>
    </BaseModal>
  );
}
