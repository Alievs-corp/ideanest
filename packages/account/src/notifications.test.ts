import { describe, expect, it } from 'vitest';
import en from '@ideanest/messages/en.json';
import { CATEGORIES, CHANNELS, modesFor } from './notifications';

describe('the preference table', () => {
  it('walks the categories and channels in §4.10’s order', () => {
    expect(CATEGORIES).toEqual([
      'PLEDGES',
      'CAMPAIGN',
      'PAYMENTS',
      'COMMUNITY',
      'REWARDS',
      'DISCOVERY',
      'SECURITY',
    ]);
    expect(CHANNELS).toEqual(['IN_APP', 'EMAIL', 'PUSH']);
  });

  it('has words for every category and channel in the catalogue', () => {
    const copy = en.account.notifications;
    for (const category of CATEGORIES) expect(copy.category[category]).toBeTruthy();
    for (const channel of CHANNELS) expect(copy.channel[channel]).toBeTruthy();
  });

  /*
   * `digestOffered` is the service's answer to "can this channel batch". A client that
   * decided it independently would drift from §4.10 the first time the table changed, and
   * the drift would show as an option the service then refuses with a 422.
   */
  it('offers a digest only where the service says one is offered', () => {
    expect(modesFor(true)).toEqual(['IMMEDIATE', 'DIGEST', 'OFF']);
    expect(modesFor(false)).toEqual(['IMMEDIATE', 'OFF']);
  });
});
