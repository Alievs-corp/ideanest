'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineAlert, Pill } from '@ideanest/ui';
import { deviceLabelOf, type SignInOutcome } from '../../lib/auth/api';
import { describeAuthFailure, type AuthFailure } from '../../lib/auth/failures';
import type { ProvidersCopy } from '../../lib/i18n/auth-copy';
import {
  configuredProviders,
  generateNonce,
  signInWithProvider,
  type ProviderConfig,
} from '../../lib/auth/providers';
import { loadExternalScript } from '../../lib/auth/script';

/**
 * §4.1's A-04 and A-05 — Google and Apple, on the sign-in and registration screens. Issue #273.
 *
 * <h2>What this component is responsible for, and what it is not</h2>
 *
 * It obtains an ID token from a provider and hands it to `signInWithProvider`. **Nothing here
 * decides whether the token is genuine.** §17.1 lists the seven checks the service makes —
 * signature against the provider's JWKS, a pinned RS256, the issuer, the audience, the
 * expiry, the age, and the nonce — and every one of them has to happen on the other side. A
 * browser cannot verify a signature against a key set it also fetched.
 *
 * <h2>Nothing renders when nothing is configured</h2>
 *
 * §17.1: "a provider without them is not enabled and its endpoint answers 501". A button that
 * always fails is worse than no button, and on this screen it is worse still — it is offered
 * to somebody who has not got in yet. In a deployment with neither identifier set, and in
 * ordinary development, this component renders nothing at all and the email form stands
 * alone.
 *
 * <h2>Google renders Google's button; Apple does not get one</h2>
 *
 * THE ASYMMETRY IS THEIRS, NOT A PREFERENCE. Google Identity Services no longer offers a
 * reliable way to raise a credential prompt from a click — the One Tap prompt is
 * browser-arbitrated through FedCM and is suppressed after a dismissal — so the supported
 * path for a custom sign-in surface is `renderButton`, which draws Google's own control in an
 * iframe. It is configured `filled_black` and `pill`, which is as close to §7.2's shape as
 * their options reach; it will never be exactly the design system, and a control that looks
 * right and does not work is the worse trade.
 *
 * Apple's SDK exposes `AppleID.auth.signIn()`, a promise a click can call, so Apple gets an
 * ordinary `Pill` and looks like the rest of the screen.
 *
 * <h2>Apple sends a name once, and forwarding it is not optional</h2>
 *
 * §17.1: Apple puts it in the body of the **first** authorisation response, never in the ID
 * token and never again. It is used only when an account is created and never modifies an
 * existing one, so forwarding it on every sign-in is harmless — and dropping it once costs
 * somebody their display name permanently.
 *
 * <h2>Motion: none</h2>
 *
 * docs/motion-system.md §5's budget for authentication. The buttons take 150ms of colour on
 * hover from `Pill`; nothing else moves, including the failure, which appears outright.
 */

const GOOGLE_SDK = 'https://accounts.google.com/gsi/client';
const APPLE_SDK =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

/* -------------------------------------------------------------------------
 * The two SDKs, narrowed to what is called
 * ---------------------------------------------------------------------- */

interface GoogleCredentialResponse {
  readonly credential?: string;
}

interface GoogleIdentityServices {
  readonly accounts: {
    readonly id: {
      initialize(config: {
        client_id: string;
        nonce: string;
        callback: (response: GoogleCredentialResponse) => void;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'small' | 'medium' | 'large';
          shape?: 'rectangular' | 'pill' | 'circle' | 'square';
          text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
          width?: number;
          logo_alignment?: 'left' | 'center';
        },
      ): void;
    };
  };
}

interface AppleSignInResponse {
  readonly authorization?: { readonly id_token?: string };
  readonly user?: { readonly name?: { readonly firstName?: string; readonly lastName?: string } };
}

interface AppleIdSdk {
  readonly auth: {
    init(config: {
      clientId: string;
      scope: string;
      redirectURI: string;
      usePopup: boolean;
      nonce: string;
    }): void;
    signIn(): Promise<AppleSignInResponse>;
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
    AppleID?: AppleIdSdk;
  }
}

/* -------------------------------------------------------------------------
 * The component
 * ---------------------------------------------------------------------- */

export interface ProviderSignInProps {
  /**
   * What to do with a session, or with the challenge that stands in for one.
   *
   * The same handler the password form uses. `TokenController` answers both paths through one
   * `respondTo`, so a provider sign-in into an account with a second factor produces a
   * challenge exactly as a password sign-in does — and a component that assumed otherwise
   * would sign somebody in past their own two-factor.
   */
  readonly onOutcome: (outcome: SignInOutcome) => void | Promise<void>;
  /** `signin_with` on the sign-in page, `signup_with` on registration. Google's own wording. */
  readonly intent?: 'sign-in' | 'register';
  /**
   * The words, resolved by the page — issue #324.
   *
   * Google's own button is the one control on this screen whose text is not ours: it is drawn
   * inside their iframe and is labelled by whatever language their SDK resolves. That is not a
   * gap this copy can close, and pretending otherwise would mean a `locale` parameter that
   * their `renderButton` does not take.
   */
  readonly copy: ProvidersCopy;
}

export function ProviderSignIn({ onOutcome, intent = 'sign-in', copy }: ProviderSignInProps) {
  /*
   * Read once. `configuredProviders` is pure over build-time constants, so calling it on
   * every render would produce a new array each time and defeat the effect's dependency
   * comparison below.
   */
  const [providers] = useState<readonly ProviderConfig[]>(() => configuredProviders());
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const googleSlot = useRef<HTMLDivElement>(null);

  const google = providers.find((provider) => provider.id === 'google') ?? null;
  const apple = providers.find((provider) => provider.id === 'apple') ?? null;

  const exchange = useCallback(
    async (
      provider: 'google' | 'apple',
      idToken: string,
      nonce: string,
      name?: string,
    ): Promise<void> => {
      setBusy(true);
      setFailure(null);
      try {
        const label = typeof navigator === 'undefined' ? undefined : deviceLabelOf(navigator.userAgent);
        const outcome = await signInWithProvider({
          provider,
          idToken,
          nonce,
          ...(name === undefined ? {} : { name }),
          ...(label === undefined ? {} : { deviceLabel: label }),
        });
        await onOutcome(outcome);
      } catch (cause) {
        setFailure(describeAuthFailure(cause, copy.failures));
      } finally {
        setBusy(false);
      }
    },
    [onOutcome, copy.failures],
  );

  /*
   * Google's button is drawn by Google, into a slot this component owns.
   *
   * The nonce is generated once per mount and handed to `initialize`, which embeds it in the
   * token Google signs; the same value is sent beside the token so the service can compare
   * them. Regenerating it per click would mean the token carries a nonce the exchange no
   * longer knows.
   */
  useEffect(() => {
    if (google === null) return;

    let cancelled = false;
    const nonce = generateNonce();

    void loadExternalScript(GOOGLE_SDK)
      .then(() => {
        const slot = googleSlot.current;
        const sdk = window.google;
        if (cancelled || slot === null || sdk === undefined) return;

        sdk.accounts.id.initialize({
          client_id: google.clientId,
          nonce,
          use_fedcm_for_prompt: true,
          callback: (response) => {
            const credential = response.credential ?? '';
            if (credential === '') return;
            void exchange('google', credential, nonce);
          },
        });

        slot.replaceChildren();
        sdk.accounts.id.renderButton(slot, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: intent === 'register' ? 'signup_with' : 'signin_with',
          logo_alignment: 'center',
        });
      })
      .catch(() => {
        if (cancelled) return;
        /*
         * The script itself did not load — an ad blocker, a captive portal, an outage. There
         * is nothing to press, so the slot stays empty and the email form beside it is the
         * answer. A banner here would tell somebody about a control they cannot see.
         */
      });

    return () => {
      cancelled = true;
    };
  }, [google, intent, exchange]);

  async function signInWithApple(): Promise<void> {
    if (apple === null || busy) return;

    setBusy(true);
    setFailure(null);
    const nonce = generateNonce();

    try {
      await loadExternalScript(APPLE_SDK);
      const sdk = window.AppleID;
      if (sdk === undefined) throw new Error('Apple sign-in did not load.');

      sdk.auth.init({
        clientId: apple.clientId,
        scope: 'name email',
        /*
         * Apple requires a registered redirect URI even in the popup flow, where nothing is
         * redirected. It is this application's own sign-in page, read from the browser rather
         * than configured, so a preview deployment does not need a second variable.
         */
        redirectURI: `${window.location.origin}/sign-in`,
        usePopup: true,
        nonce,
      });

      const response = await sdk.auth.signIn();
      const idToken = response.authorization?.id_token ?? '';
      if (idToken === '') return;

      const first = response.user?.name?.firstName ?? '';
      const last = response.user?.name?.lastName ?? '';
      const name = `${first} ${last}`.trim();

      setBusy(false);
      await exchange('apple', idToken, nonce, name === '' ? undefined : name);
    } catch (cause) {
      /*
       * A cancelled popup is not a failure. Apple reports it as `popup_closed_by_user`, and
       * telling somebody their sign-in failed because they changed their mind is noise on a
       * screen where every message is read as a problem with their account.
       */
      const cancelledByUser =
        typeof cause === 'object' &&
        cause !== null &&
        'error' in cause &&
        (cause as { error?: unknown }).error === 'popup_closed_by_user';

      if (!cancelledByUser) setFailure(describeAuthFailure(cause, copy.failures));
      setBusy(false);
    }
  }

  if (providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {/*
        A labelled separator rather than a bare rule. `aria-hidden` on the lines and a real
        word between them, so the relationship between the two halves of the screen is
        announced rather than drawn.
      */}
      <div className="flex items-center gap-4" role="separator" aria-label={copy.separatorLabel}>
        <span aria-hidden="true" className="h-px flex-1 bg-fg/6" />
        <span className="text-xs tracking-[0.08em] text-fg-40 uppercase">{copy.or}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-fg/6" />
      </div>

      {failure !== null && (
        <InlineAlert variant="danger" title={failure.title}>
          <p>{failure.detail}</p>
        </InlineAlert>
      )}

      {google !== null && (
        /*
         * `min-h` so the column does not jump when Google's iframe arrives. The slot is
         * measured at the height their `large` button renders at.
         */
        <div ref={googleSlot} className="flex min-h-[44px] justify-center" />
      )}

      {apple !== null && (
        <Pill
          type="button"
          variant="outline"
          size="lg"
          fullWidth
          disabled={busy}
          onClick={() => void signInWithApple()}
        >
          {intent === 'register' ? copy.appleRegister : copy.appleSignIn}
        </Pill>
      )}
    </div>
  );
}
