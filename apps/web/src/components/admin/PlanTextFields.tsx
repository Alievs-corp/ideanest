'use client';

import { Field, TextInput } from '@ideanest/ui';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '../../lib/i18n/locale';
import type { Plan, PlanTranslations } from '../../lib/admin/plans';
import type { PlanManagerCopy } from '../../lib/i18n/admin/money-copy';

/**
 * A plan's name and description in every language, one language on screen at a time.
 *
 * Azerbaijani is the plan's own `name` and `description`, required, and the language the form
 * opens on. The others are optional: a reader in a language left empty sees the Azerbaijani,
 * which the hint under the language buttons says.
 */
export type PlanTextDraft = Readonly<Record<Locale, { readonly name: string; readonly description: string }>>;

const TRANSLATED = SUPPORTED_LOCALES.filter((locale) => locale !== 'az') as readonly Exclude<Locale, 'az'>[];

export function emptyPlanTexts(): PlanTextDraft {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, { name: '', description: '' }])) as PlanTextDraft;
}

export function planTextsOf(plan: Plan): PlanTextDraft {
  return {
    ...emptyPlanTexts(),
    az: { name: plan.name, description: plan.description ?? '' },
    ...Object.fromEntries(
      TRANSLATED.map((locale) => {
        const text = plan.translations?.[locale];
        return [locale, { name: text?.name ?? '', description: text?.description ?? '' }];
      }),
    ),
  } as PlanTextDraft;
}

/** Every language with a name, trimmed. A language with no name is left out, so it reads in Azerbaijani. */
export function translationsFrom(draft: PlanTextDraft): PlanTranslations {
  const translations: Partial<Record<Exclude<Locale, 'az'>, { name: string; description: string | null }>> = {};
  for (const locale of TRANSLATED) {
    const name = draft[locale].name.trim();
    const description = draft[locale].description.trim();
    if (name !== '') translations[locale] = { name, description: description === '' ? null : description };
  }
  return translations;
}

/** The first language with a description and no name, which the service would refuse. */
export function namelessLanguage(draft: PlanTextDraft): Locale | undefined {
  return TRANSLATED.find((locale) => draft[locale].name.trim() === '' && draft[locale].description.trim() !== '');
}

interface PlanTextFieldsProps {
  readonly draft: PlanTextDraft;
  readonly onChange: (draft: PlanTextDraft) => void;
  readonly language: Locale;
  readonly onLanguage: (language: Locale) => void;
  readonly copy: PlanManagerCopy;
}

export function PlanTextFields({ draft, onChange, language, onLanguage, copy }: PlanTextFieldsProps) {
  const text = draft[language];
  const nameless = namelessLanguage(draft);
  const set = (field: 'name' | 'description', value: string) =>
    onChange({ ...draft, [language]: { ...text, [field]: value } });

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={copy.languageLegend} className="flex flex-wrap gap-2">
        {SUPPORTED_LOCALES.map((option) => {
          const filled = option !== 'az' && draft[option].name.trim() !== '';
          return (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              onClick={() => onLanguage(option)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] ${
                language === option
                  ? 'border-white bg-white text-black'
                  : 'border-white/16 text-white/80 hover:border-white/40 hover:text-white'
              }`}
            >
              {LOCALE_NAMES[option]}
              {filled && (
                <>
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">, {copy.languageFilled}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <p className="max-w-[62ch] text-[13px] text-white/64">{copy.languageHint}</p>

      <Field label={copy.nameLabel} error={nameless === language ? copy.translationNameMissing : undefined}>
        <TextInput lang={language} value={text.name} onChange={(event) => set('name', event.target.value)} maxLength={120} />
      </Field>

      <Field label={copy.descriptionLabel} hint={copy.descriptionHint}>
        <TextInput
          lang={language}
          value={text.description}
          onChange={(event) => set('description', event.target.value)}
          maxLength={2000}
        />
      </Field>

      {nameless !== undefined && nameless !== language && (
        <p role="alert" className="text-[13px] text-danger">
          {LOCALE_NAMES[nameless]}: {copy.translationNameMissing}
        </p>
      )}
    </div>
  );
}
