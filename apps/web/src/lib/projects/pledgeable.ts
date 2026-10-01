/*
 * Whether a campaign can be backed right now lives in `@ideanest/campaign/pledgeable` since
 * #155, so the app's Back pill and reward selects ask the question the web's do and get the
 * same answer. The module comment there says why it is a prediction and not a permission.
 * Re-exported under the same names, so no caller here changed.
 */
export { PLEDGEABLE_PROJECT_STATES, acceptsPledges } from '@ideanest/campaign/pledgeable';
