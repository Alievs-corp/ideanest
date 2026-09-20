import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurveyBuilder } from './SurveyBuilder';
import { surveyBuilderCopyFrom } from '../../lib/i18n/dashboard-copy';
import { translatorFor } from '../../test-copy';
import type { Survey } from '../../lib/dashboard/surveys';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #79.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = surveyBuilderCopyFrom(translatorFor('dashboard'));


/**
 * §4.8's PM-01 to PM-04 in the browser (#73).
 *
 * <p>Behaviour and accessibility, per `CLAUDE.md`: appearance is reviewed in Storybook.
 * What is asserted here is what a creator can and cannot do — which is where this screen's
 * design lives, because a sent survey's questions are frozen and the control has to say
 * so before the service refuses it.
 */

function survey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-1',
    title: 'Reward details',
    sent: false,
    responseCount: 0,
    questions: [
      { id: 'q1', prompt: 'What size?', type: 'CHOICE', required: true, choices: ['S', 'M'], rewardTierId: '' },
    ],
    ...overrides,
  };
}

describe('SurveyBuilder', () => {
  it('lists the campaign surveys and says which are drafts', async () => {
    render(<SurveyBuilder projectId="p1" load={async () => [survey()]} copy={COPY} />);

    expect(await screen.findByRole('button', { name: 'Reward details' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('reports how many a sent survey reached and how many answered', async () => {
    render(
      <SurveyBuilder
        projectId="p1"
        load={async () => [survey({ sent: true, sentTo: 412, responseCount: 87 })]}
        copy={COPY}
      />,
    );

    // The state is a word rather than a colour. ui-kit §9.2.
    expect(await screen.findByText('Sent to 412 · 87 answered')).toBeInTheDocument();
  });

  /**
   * The rule this screen exists to make visible.
   *
   * <p>The service refuses a change to a sent survey's questions; the builder disables the
   * controls so a creator is not offered an edit that is known to be refused.
   */
  it('freezes the questions of a sent survey and leaves the covering note editable', async () => {
    const user = userEvent.setup();
    render(<SurveyBuilder projectId="p1" load={async () => [survey({ sent: true, sentTo: 3 })]} copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Reward details' }));

    expect(screen.getByLabelText(/Question 1/)).toBeDisabled();
    expect(screen.getByLabelText(/Covering note/)).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Send to backers/ })).not.toBeInTheDocument();
  });

  it('offers a draft for editing and saves the whole survey back', async () => {
    const user = userEvent.setup();
    const update = vi.fn(async () => survey({ title: 'Reward details v2' }));

    render(<SurveyBuilder projectId="p1" load={async () => [survey()]} update={update} copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Reward details' }));
    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), 'Reward details v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith('survey-1', expect.objectContaining({ title: 'Reward details v2' }));
  });

  /**
   * Sending is the one irreversible control on the dashboard, so it asks — and the second
   * label says what will happen rather than repeating the first.
   */
  it('asks before sending, and only sends on the second press', async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => survey({ sent: true, sentTo: 2 }));

    render(<SurveyBuilder projectId="p1" load={async () => [survey()]} send={send} copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Reward details' }));
    await user.click(screen.getByRole('button', { name: /Send to backers/ }));

    expect(send).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: /this cannot be undone/ });

    await user.click(confirm);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to 2 backers.');
  });

  it('shows the options control only for the types that have options', async () => {
    const user = userEvent.setup();
    render(<SurveyBuilder projectId="p1" load={async () => []} copy={COPY} />);

    await waitFor(() => expect(screen.getByLabelText(/Answer type/)).toBeInTheDocument());
    expect(screen.queryByLabelText(/^Options/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Answer type/), 'CHOICE');
    expect(screen.getByLabelText(/^Options/)).toBeInTheDocument();
  });

  /**
   * PM-03's address type stores no answer here — it points at the pledge's encrypted
   * address row — so "this has to be answered" would be a control nothing reads.
   */
  it('replaces the required checkbox with an explanation for an address question', async () => {
    const user = userEvent.setup();
    render(<SurveyBuilder projectId="p1" load={async () => []} copy={COPY} />);

    await waitFor(() => expect(screen.getByLabelText(/Answer type/)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Answer type/), 'ADDRESS');

    expect(screen.queryByRole('checkbox', { name: /has to be answered/ })).not.toBeInTheDocument();
    expect(screen.getByText(/stored encrypted/)).toBeInTheDocument();
  });

  it('offers PM-02s condition only when the campaign has reward tiers', async () => {
    render(
      <SurveyBuilder
        projectId="p1"
        load={async () => []}
        rewardTiers={[{ id: 'tier-1', title: 'Boxed set' }]}
        copy={COPY}
      />,
    );

    expect(await screen.findByLabelText(/Ask only the backers who chose/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Everybody' })).toBeInTheDocument();
  });

  it('explains a refusal in terms a creator can act on', async () => {
    render(
      <SurveyBuilder
        projectId="p1"
        load={async () => {
          throw Object.assign(new Error('nope'), { name: 'ApiError' });
        }}
        copy={COPY}
      />,
    );

    expect(await screen.findByText(/could not be loaded|could not be saved/)).toBeInTheDocument();
  });
});
