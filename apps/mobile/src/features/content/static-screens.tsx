import {
  Heading2,
  Paragraph,
  RichParagraph,
  RuledList,
  StaticPage,
} from '../../components/content/static-page';
import { useT } from '../../lib/i18n';

/*
 * About, How it works and Trust and safety — the web's three `(site)` pages, issue #164, block for
 * block and key for key: the same order, the same `static.*` sentences, the same links. The words
 * are bundled with the app, so the pages need no network and render offline and on first launch.
 *
 * Links go to the app's own routes. The guarded ones (`account/*`, `settings/*`) ask a signed-out
 * reader to sign in on arrival and come back, as every native screen behind a session does.
 */

export function AboutScreen() {
  const t = useT('static.about');
  return (
    <StaticPage title={t('title')} summary={t('summary')} sharePath="/about" testID="about-screen">
      <Paragraph>{t('intro')}</Paragraph>

      <Heading2>{t('allOrNothing.heading')}</Heading2>
      <Paragraph>{t('allOrNothing.first')}</Paragraph>
      <Paragraph>{t('allOrNothing.second')}</Paragraph>

      <Heading2>{t('cost.heading')}</Heading2>
      <RuledList>
        <RichParagraph>
          {(tag) => t.rich('cost.successful', { b: tag.b, pricing: tag.link('/pricing') })}
        </RichParagraph>
        <RichParagraph>{(tag) => t.rich('cost.unsuccessful', { b: tag.b })}</RichParagraph>
      </RuledList>
      <Paragraph>{t('cost.note')}</Paragraph>

      <Heading2>{t('notAPurchase.heading')}</Heading2>
      <Paragraph>{t('notAPurchase.body')}</Paragraph>

      <Heading2>{t('next.heading')}</Heading2>
      <RichParagraph>
        {(tag) =>
          t.rich('next.body', {
            howItWorks: tag.link('/how-it-works'),
            trustSafety: tag.link('/trust-safety'),
          })
        }
      </RichParagraph>
    </StaticPage>
  );
}

export function HowItWorksScreen() {
  const t = useT('static.howItWorks');
  return (
    <StaticPage
      title={t('title')}
      summary={t('summary')}
      sharePath="/how-it-works"
      testID="how-it-works-screen"
    >
      <Heading2>{t('backing.heading')}</Heading2>
      <RichParagraph>{(tag) => t.rich('backing.first', { b: tag.b })}</RichParagraph>
      <Paragraph>{t('backing.second')}</Paragraph>
      <Paragraph>{t('backing.third')}</Paragraph>

      <Heading2>{t('surveys.heading')}</Heading2>
      <RichParagraph>
        {(tag) => t.rich('surveys.first', { surveys: tag.link('/account/surveys') })}
      </RichParagraph>
      <RichParagraph>
        {(tag) => t.rich('surveys.second', { deliveries: tag.link('/account/deliveries') })}
      </RichParagraph>

      <Heading2>{t('running.heading')}</Heading2>
      <RuledList>
        <RichParagraph>{(tag) => t.rich('running.draft', { b: tag.b })}</RichParagraph>
        <RichParagraph>{(tag) => t.rich('running.rewards', { b: tag.b })}</RichParagraph>
        <RichParagraph>{(tag) => t.rich('running.submit', { b: tag.b })}</RichParagraph>
        <RichParagraph>{(tag) => t.rich('running.launch', { b: tag.b })}</RichParagraph>
        <RichParagraph>{(tag) => t.rich('running.deliver', { b: tag.b })}</RichParagraph>
      </RuledList>

      <Heading2>{t('agreeing.heading')}</Heading2>
      <Paragraph>{t('agreeing.first')}</Paragraph>
      <RichParagraph>
        {(tag) => t.rich('agreeing.second', { trustSafety: tag.link('/trust-safety') })}
      </RichParagraph>
    </StaticPage>
  );
}

export function TrustSafetyScreen() {
  const t = useT('static.trustSafety');
  return (
    <StaticPage
      title={t('title')}
      summary={t('summary')}
      sharePath="/trust-safety"
      testID="trust-safety-screen"
    >
      <Heading2>{t('review.heading')}</Heading2>
      <Paragraph>{t('review.first')}</Paragraph>
      <Paragraph>{t('review.second')}</Paragraph>

      <Heading2>{t('notAllowed.heading')}</Heading2>
      <RuledList>
        <Paragraph>{t('notAllowed.prohibited')}</Paragraph>
        <Paragraph>{t('notAllowed.misrepresentation')}</Paragraph>
        <Paragraph>{t('notAllowed.notOwn')}</Paragraph>
        <Paragraph>{t('notAllowed.offensive')}</Paragraph>
        <Paragraph>{t('notAllowed.spam')}</Paragraph>
        <Paragraph>{t('notAllowed.fraud')}</Paragraph>
      </RuledList>

      <Heading2>{t('reporting.heading')}</Heading2>
      <Paragraph>{t('reporting.first')}</Paragraph>
      <Paragraph>{t('reporting.second')}</Paragraph>

      <Heading2>{t('money.heading')}</Heading2>
      <Paragraph>{t('money.first')}</Paragraph>
      <Paragraph>{t('money.second')}</Paragraph>

      <Heading2>{t('account.heading')}</Heading2>
      <RuledList>
        <RichParagraph>
          {(tag) =>
            t.rich('account.twoFactor', { b: tag.b, security: tag.link('/settings/security') })
          }
        </RichParagraph>
        <RichParagraph>
          {(tag) =>
            t.rich('account.devices', { b: tag.b, sessions: tag.link('/settings/sessions') })
          }
        </RichParagraph>
        <RichParagraph>{(tag) => t.rich('account.addresses', { b: tag.b })}</RichParagraph>
        <RichParagraph>
          {(tag) => t.rich('account.data', { b: tag.b, privacy: tag.link('/settings/privacy') })}
        </RichParagraph>
      </RuledList>

      <Heading2>{t('limits.heading')}</Heading2>
      <Paragraph>{t('limits.first')}</Paragraph>
      <Paragraph>{t('limits.second')}</Paragraph>
    </StaticPage>
  );
}
