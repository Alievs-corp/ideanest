/*
 * `completionOf` lives in `@ideanest/campaign/completion` since #155, so the app's live counter
 * computes the percent with the same rounding rule. Still a leaf there, which is what the
 * campaign route's First Load JS budget needs; the module comment says why.
 */
export { completionOf } from '@ideanest/campaign/completion';
