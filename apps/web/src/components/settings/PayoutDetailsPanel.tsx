'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CreditCard, Landmark } from 'lucide-react';
import { checkAzerbaijaniIban, ibanDefectOf, reformatIban } from '@ideanest/account/iban';
import { Field, InlineAlert, Pill, Skeleton, SkeletonGroup, TextInput } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import {
  beginPayoutCardRegistration,
  cardReturnFor,
  cardReturnHint,
  getMyLegalSubject,
  getMyPayoutDestination,
  saveMyBankAccount,
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
 * Who is paid, and the account the money goes to — IDN-EXT-01 (#44), a bank account since #395.
 *
 * <h2>Three parts, saved separately</h2>
 *
 * The legal subject — individual or company, the legal name, the VÖEN — is a form, saved with
 * `PUT /v1/me/legal-subject`. The bank account is the second form: the IBAN and the holder's name,
 * saved with `PUT /v1/me/payout-destination/bank-account`. Creators are paid by bank transfer, so
 * this is the primary path. The IBAN is grouped in fours while it is typed, checked by
 * `@ideanest/account/iban` in the service's own terms, and sent in its electronic form; once filed
 * it is only ever shown as the service's masked hint, and the field is emptied.
 *
 * A business card registered on the payment provider's page is the third part, and appears only
 * when `cardRegistrationAvailable` says the configured provider can take one. A card number is
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
 * beside the account rather than a colour. A holder's name that does not match is said in words.
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

  const [iban, setIban] = useState('');
  const [holder, setHolder] = useState('');
  const [bankSaving, setBankSaving] = useState(false);
  const [bankSaved, setBankSaved] = useState(false);
  const [ibanError, setIbanError] = useState<string | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const caret = useRef<{ readonly input: HTMLInputElement; readonly at: number } | null>(null);
  const bankForm = useRef<HTMLFormElement>(null);

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
        // The holder on file, else the legal name: the two have to match, so it is the likely answer.
        setHolder((isBankAccount(current) ? current.holderName : subject.legalName) ?? '');
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

  useLayoutEffect(() => {
    const pending = caret.current;
    if (pending === null) return;
    caret.current = null;
    if (document.activeElement === pending.input) pending.input.setSelectionRange(pending.at, pending.at);
  }, [iban]);

  useEffect(() => {
    if (ibanError !== null) bankForm.current?.querySelector<HTMLInputElement>('input[name="iban"]')?.focus();
  }, [ibanError]);

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
      // The standing depends on the legal name, so the destination's standing is read again.
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

  function typeIban(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const forward = (event.nativeEvent as Partial<InputEvent>).inputType === 'deleteContentForward';
    const next = reformatIban(iban, input.value, input.selectionStart ?? input.value.length, forward ? 'forward' : 'backward');
    caret.current = { input, at: next.caret };
    setIban(next.value);
    setIbanError(null);
    setBankSaved(false);
  }

  async function saveBank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bankSaving) return;
    setBankSaved(false);
    setBankError(null);
    const checked = checkAzerbaijaniIban(iban);
    if (!checked.ok) {
      setIbanError(copy.ibanDefect[checked.defect]);
      return;
    }
    setIbanError(null);
    setBankSaving(true);
    try {
      const next = await saveMyBankAccount({ iban: checked.value, holderName: holder.trim() });
      setDestination(next);
      setIban('');
      setBankSaved(true);
    } catch (cause) {
      const problem = cause instanceof ApiError ? cause.problem : undefined;
      const defect = problem?.code === 'MALFORMED_IBAN' ? ibanDefectOf(problem.meta?.['defect']) : null;
      if (defect !== null) {
        setIbanError(copy.ibanDefect[defect]);
      } else {
        setBankError(problem?.code === 'ENCRYPTED_STORAGE_UNAVAILABLE' ? copy.bankUnavailable : copy.failed);
      }
    } finally {
      setBankSaving(false);
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

  const cardOnFile = destination.recorded && !isBankAccount(destination);
  const OnFileIcon = cardOnFile ? CreditCard : Landmark;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="payout-subject-heading" className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
        <h2 id="payout-subject-heading" className="text-lg font-medium tracking-[-0.02em] text-fg">
          {copy.subjectHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.subjectIntro}</p>

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
            <p role="status" className="text-sm text-fg-64">
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

      <section aria-labelledby="payout-bank-heading" className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
        <h2 id="payout-bank-heading" className="text-lg font-medium tracking-[-0.02em] text-fg">
          {copy.bankHeading}
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.bankIntro}</p>

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
          <OnFileIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-40" />
          {destination.recorded ? (
            <div>
              <p className="text-fg">
                {fillPlaceholders(cardOnFile ? copy.cardOnFile : copy.accountOnFile, {
                  hint: destination.displayHint ?? '',
                  holder: destination.holderName ?? '',
                })}
              </p>
              <p className="mt-1 text-fg-64">{standingWord(destination.standing, copy)}</p>
            </div>
          ) : (
            <p className="text-fg-64">{copy.accountNone}</p>
          )}
        </div>

        {destination.standing === 'NAME_MISMATCH' && (
          <div className="mt-4">
            <InlineAlert variant="warning">
              <p>{copy.mismatchHelp}</p>
            </InlineAlert>
          </div>
        )}

        <form ref={bankForm} onSubmit={saveBank} noValidate className="mt-6 flex max-w-[30rem] flex-col gap-5">
          <Field label={copy.ibanLabel} hint={copy.ibanHint} error={ibanError} required>
            <TextInput
              name="iban"
              value={iban}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
              onChange={typeIban}
            />
          </Field>

          <Field label={copy.holderLabel} hint={copy.holderHint} required>
            <TextInput
              value={holder}
              autoComplete="off"
              onChange={(event) => {
                setHolder(event.currentTarget.value);
                setBankSaved(false);
              }}
            />
          </Field>

          {bankError !== null && <InlineAlert variant="danger">{bankError}</InlineAlert>}
          {bankSaved && (
            <p role="status" className="text-sm text-fg-64">
              {copy.bankSaved}
            </p>
          )}

          <div>
            <Pill
              type="submit"
              variant="outline"
              aria-disabled={bankSaving}
              disabled={iban.trim() === '' || holder.trim() === ''}
            >
              {bankSaving ? copy.saving : copy.saveBank}
            </Pill>
          </div>
        </form>
      </section>

      {destination.cardRegistrationAvailable === true && (
        <section aria-labelledby="payout-card-heading" className="rounded-2xl border border-fg/8 bg-surface-2 p-6 sm:p-8">
          <h2 id="payout-card-heading" className="text-lg font-medium tracking-[-0.02em] text-fg">
            {copy.cardHeading}
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{copy.cardIntro}</p>

          {cardError !== null && (
            <div className="mt-4">
              <InlineAlert variant="danger">{cardError}</InlineAlert>
            </div>
          )}

          <div className="mt-5">
            <Pill type="button" variant="outline" aria-disabled={opening} onClick={() => void registerCard()}>
              {opening ? copy.opening : cardOnFile ? copy.replace : copy.register}
            </Pill>
          </div>
        </section>
      )}
    </div>
  );
}

/** A bank account on file (#394). A recorded row without `kind` predates it, and is a card. */
function isBankAccount(destination: PayoutDestination): boolean {
  return destination.recorded && destination.kind === 'BANK_TRANSFER';
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
      return copy.accountNone;
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
