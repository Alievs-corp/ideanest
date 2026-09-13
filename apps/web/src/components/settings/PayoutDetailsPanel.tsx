'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreditCard } from 'lucide-react';
import { Field, InlineAlert, Pill, Skeleton, SkeletonGroup, TextInput } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  beginPayoutCardRegistration,
  cardReturnFor,
  cardReturnHint,
  getMyLegalSubject,
  getMyPayoutDestination,
  saveMyLegalSubject,
  type CardReturnHint,
  type DestinationStanding,
  type PayoutDestination,
  type SubjectKind,
} from '../../lib/account/payout';
import type { PayoutPanelCopy } from '../../lib/i18n/payout-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { leaveForPaymentPage } from '../../lib/pledges/payment';

/**
 * Who is paid, and the card the money goes to — IDN-EXT-01 (#44).
 *
 * <h2>Two halves, saved separately</h2>
 *
 * The legal subject — individual or company, the legal name, the VÖEN — is a form, saved with
 * `PUT /v1/me/legal-subject`. The card is not a form at all: it is registered on the payment
 * provider's page and filed by the provider's callback, so this panel only shows what is on file,
 * its verification standing, and a control that sends the creator to the provider. A card number is
 * never entered here.
 *
 * <h2>Coming back from the provider</h2>
 *
 * `?card=returned` means the creator finished on the provider's page, not that the card is filed:
 * the callback may land after the browser. So the destination is re-read every three seconds for a
 * minute, until it changes, and until then the panel says it is waiting. `?card=failed` says the
 * card was not registered and that nothing on file changed, which is true either way.
 *
 * <h2>Motion and colour</h2>
 *
 * None, and neutral: this is account settings (docs/motion-system.md §5), and the standing is a word
 * beside the card rather than a colour.
 */

const CHECKS = 20;
const CHECK_INTERVAL_MS = 3000;

type Status = 'loading' | 'ready' | 'failed';

export interface PayoutDetailsPanelProps {
  readonly copy: PayoutPanelCopy;
}

export function PayoutDetailsPanel({ copy }: PayoutDetailsPanelProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [destination, setDestination] = useState<PayoutDestination | null>(null);

  const [kind, setKind] = useState<SubjectKind>('INDIVIDUAL');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [taxIdError, setTaxIdError] = useState<string | null>(null);

  const [opening, setOpening] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [returned, setReturned] = useState<CardReturnHint | null>(null);
  const [firstUpdate, setFirstUpdate] = useState<string | null | undefined>(undefined);
  const [checks, setChecks] = useState(0);

  const readDestination = useCallback(async () => {
    const current = await getMyPayoutDestination();
    setDestination(current);
    return current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReturned(cardReturnHint(window.location.search));
    void (async () => {
      try {
        const [subject, current] = await Promise.all([getMyLegalSubject(), getMyPayoutDestination()]);
        if (cancelled) return;
        if (subject.recorded) {
          setKind(subject.subjectKind ?? 'INDIVIDUAL');
          setLegalName(subject.legalName ?? '');
          setTaxId(subject.taxId ?? '');
          setRegisteredAddress(subject.registeredAddress ?? '');
          setRegistrationNumber(subject.registrationNumber ?? '');
        }
        setDestination(current);
        setFirstUpdate(current.updatedAt ?? null);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const changedSinceReturn = destination !== null && firstUpdate !== undefined && (destination.updatedAt ?? null) !== firstUpdate;
  const waiting = returned === 'returned' && !changedSinceReturn && checks < CHECKS;

  useEffect(() => {
    if (!waiting || status !== 'ready') return;
    const timer = setTimeout(() => {
      setChecks((count) => count + 1);
      void readDestination().catch(() => undefined);
    }, CHECK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [waiting, status, checks, readDestination]);

  async function saveSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setSubjectError(null);
    setTaxIdError(null);
    try {
      await saveMyLegalSubject({
        subjectKind: kind,
        legalName: legalName.trim(),
        taxId: blankToNull(taxId),
        registeredAddress: kind === 'LEGAL_ENTITY' ? blankToNull(registeredAddress) : null,
        registrationNumber: kind === 'LEGAL_ENTITY' ? blankToNull(registrationNumber) : null,
      });
      setSaved(true);
      // The standing depends on the legal name, so the card's standing is read again.
      void readDestination().catch(() => undefined);
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem?.code === 'MALFORMED_TAX_IDENTIFIER') {
        setTaxIdError(copy.malformedTaxId);
      } else {
        setSubjectError(copy.failed);
      }
    } finally {
      setSaving(false);
    }
  }

  async function registerCard() {
    if (opening) return;
    setOpening(true);
    setCardError(null);
    try {
      const page = await beginPayoutCardRegistration(cardReturnFor());
      leaveForPaymentPage(page.redirectUrl);
    } catch (cause) {
      setCardError(
        cause instanceof ApiError && cause.problem?.code === 'PAYOUT_CARDS_UNAVAILABLE' ? copy.unavailable : copy.failed,
      );
      setOpening(false);
    }
  }

  if (status === 'loading') {
    return (
      <SkeletonGroup label={copy.loading} className="flex flex-col gap-4">
        <Skeleton height="14rem" />
        <Skeleton height="8rem" />
      </SkeletonGroup>
    );
  }

  if (status === 'failed' || destination === null) {
    return <InlineAlert variant="danger">{copy.failed}</InlineAlert>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="payout-subject-heading" className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
        <h2 id="payout-subject-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.subjectHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.subjectIntro}</p>

        <form onSubmit={saveSubject} noValidate className="mt-6 flex max-w-[30rem] flex-col gap-5">
          <div role="group" aria-label={copy.kind} className="flex flex-wrap gap-2">
            {(['INDIVIDUAL', 'LEGAL_ENTITY'] as const).map((option) => (
              <Pill
                key={option}
                type="button"
                variant={kind === option ? 'outline' : 'ghost'}
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
              >
                {option === 'INDIVIDUAL' ? copy.kindIndividual : copy.kindEntity}
              </Pill>
            ))}
          </div>

          <Field label={copy.legalName} hint={copy.legalNameHint} required>
            <TextInput value={legalName} autoComplete="name" onChange={(event) => setLegalName(event.currentTarget.value)} />
          </Field>

          <Field label={copy.taxId} hint={copy.taxIdHint} error={taxIdError}>
            <TextInput
              value={taxId}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => setTaxId(event.currentTarget.value)}
            />
          </Field>

          {kind === 'LEGAL_ENTITY' && (
            <>
              <Field label={copy.registeredAddress}>
                <TextInput value={registeredAddress} onChange={(event) => setRegisteredAddress(event.currentTarget.value)} />
              </Field>
              <Field label={copy.registrationNumber}>
                <TextInput value={registrationNumber} onChange={(event) => setRegistrationNumber(event.currentTarget.value)} />
              </Field>
            </>
          )}

          {subjectError !== null && <InlineAlert variant="danger">{subjectError}</InlineAlert>}
          {saved && (
            <p role="status" className="text-sm text-white/64">
              {copy.saved}
            </p>
          )}

          <div>
            <Pill type="submit" variant="outline" aria-disabled={saving} disabled={legalName.trim() === ''}>
              {saving ? copy.saving : copy.save}
            </Pill>
          </div>
        </form>
      </section>

      <section aria-labelledby="payout-card-heading" className="rounded-2xl border border-white/8 bg-surface-2 p-6 sm:p-8">
        <h2 id="payout-card-heading" className="text-lg font-medium tracking-[-0.02em] text-white">
          {copy.cardHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{copy.cardIntro}</p>

        {waiting && (
          <div className="mt-4">
            <InlineAlert variant="info">
              <p>{copy.waiting}</p>
            </InlineAlert>
          </div>
        )}
        {returned === 'failed' && (
          <div className="mt-4">
            <InlineAlert variant="warning">
              <p>{copy.cardFailed}</p>
            </InlineAlert>
          </div>
        )}

        <div className="mt-5 flex items-start gap-3 text-sm">
          <CreditCard aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-white/40" />
          {destination.recorded ? (
            <div>
              <p className="text-white">
                {fillPlaceholders(copy.cardOnFile, {
                  hint: destination.displayHint ?? '',
                  holder: destination.holderName ?? '',
                })}
              </p>
              <p className="mt-1 text-white/64">{standingWord(destination.standing, copy)}</p>
            </div>
          ) : (
            <p className="text-white/64">{copy.cardNone}</p>
          )}
        </div>

        {cardError !== null && (
          <div className="mt-4">
            <InlineAlert variant="danger">{cardError}</InlineAlert>
          </div>
        )}

        <div className="mt-5">
          <Pill type="button" variant="outline" aria-disabled={opening} onClick={() => void registerCard()}>
            {opening ? copy.opening : destination.recorded ? copy.replace : copy.register}
          </Pill>
        </div>
      </section>
    </div>
  );
}

function standingWord(standing: DestinationStanding, copy: PayoutPanelCopy): string {
  switch (standing) {
    case 'AWAITING_VERIFICATION':
      return copy.standingAwaiting;
    case 'VERIFIED':
      return copy.standingVerified;
    case 'WAIVED':
      return copy.standingWaived;
    case 'NAME_MISMATCH':
      return copy.standingMismatch;
    case 'REJECTED':
      return copy.standingRejected;
    default:
      return copy.cardNone;
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
