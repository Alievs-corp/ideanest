import en from '@ideanest/messages/en.json';
import { describe, expect, it } from 'vitest';
import { PRIVATE_PATH_PREFIXES } from './indexability';
import { llmsText } from './llms';

const BASE = 'https://ideyanest.example';

describe('llmsText', () => {
  const text = llmsText(BASE);

  it('opens with the site name and its own description, as llmstxt.org asks', () => {
    const [title, blank, summary] = text.split('\n');
    expect(title).toBe('# IdeyaNest');
    expect(blank).toBe('');
    expect(summary).toMatch(/^> Reward-based crowdfunding\./u);
  });

  it("describes each page in that page's own words", () => {
    expect(text).toContain(
      `- [${en.pricing.metaTitle}](${BASE}/en/pricing): ${en.pricing.metaDescription}`,
    );
    expect(text).toContain(`(${BASE}/en/how-it-works): ${en.static.howItWorks.metaDescription}`);
  });

  it('points at every language home', () => {
    for (const locale of ['az', 'en', 'ru', 'tr']) {
      expect(text).toContain(`(${BASE}/${locale})`);
    }
  });

  it('links nothing robots.txt asks a crawler to skip', () => {
    const links = [...text.matchAll(/\]\(([^)]+)\)/gu)].map((match) => match[1] ?? '');
    for (const link of links) {
      const path = link.slice(BASE.length).replace(/^\/[a-z]{2}(?=\/|$)/u, '') || '/';
      for (const prefix of PRIVATE_PATH_PREFIXES) {
        expect(path.startsWith(prefix), `${link} is under ${prefix}`).toBe(false);
      }
    }
  });
});
