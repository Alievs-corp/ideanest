/*
 * §5.5's update obligation as the client reads it — the five states and the two readers — lives
 * in `@ideanest/campaign/obligation` since #155, so the app's campaign screen draws the notice
 * this page draws from the same narrowing. Re-exported under the same names; the fetches are
 * `./server.ts`.
 */
export {
  OBLIGATION_STATES,
  readCreatorObligations,
  readUpdateObligation,
  type CreatorObligations,
  type ObligationState,
  type UpdateObligation,
} from '@ideanest/campaign/obligation';
