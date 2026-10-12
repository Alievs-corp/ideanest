export const LANGUAGES = ['az', 'en', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Copy {
  hook: readonly string[];
  show: readonly string[];
  gather: readonly string[];
  montage: readonly string[];
  pledge: readonly string[];
  raisedLabel: string;
  backersLabel: string;
  funded: string;
  fundedLine: readonly string[];
  url: string;
  cta: string;
}

export const COPY: Record<Language, Copy> = {
  az: {
    hook: ['Bir ideyan', 'var?'],
    show: ['Onu dünyaya', 'göstər.'],
    gather: ['İnsanlar ətrafına', 'toplaşır.'],
    montage: ['Hər dəstək onu', 'yaxınlaşdırır.'],
    pledge: ['Mükafatını seç,', 'dəstək ol.'],
    raisedLabel: 'toplandı',
    backersLabel: 'dəstəkçi',
    funded: 'Hədəfə çatdı',
    fundedLine: ['İdeya yuvasını', 'tapdı.'],
    url: 'ideyanest.com',
    cta: 'Sən də başla',
  },
  en: {
    hook: ['Got an', 'idea?'],
    show: ['Show it to', 'the world.'],
    gather: ['People gather', 'around it.'],
    montage: ['Every pledge brings', 'it closer.'],
    pledge: ['Pick a reward,', 'back it.'],
    raisedLabel: 'raised',
    backersLabel: 'backers',
    funded: 'Funded',
    fundedLine: ['The idea found', 'its nest.'],
    url: 'ideyanest.com',
    cta: 'Start yours',
  },
  ru: {
    hook: ['Есть', 'идея?'],
    show: ['Покажи её', 'миру.'],
    gather: ['Люди собираются', 'вокруг.'],
    montage: ['Каждая поддержка', 'приближает её.'],
    pledge: ['Выбери награду,', 'поддержи.'],
    raisedLabel: 'собрано',
    backersLabel: 'сторонников',
    funded: 'Цель достигнута',
    fundedLine: ['Идея нашла', 'своё гнездо.'],
    url: 'ideyanest.com',
    cta: 'Начни своё',
  },
};

export const FUNDED_CAMPAIGN = { amount: '12650.00', currency: 'AZN', backers: 141 } as const;
