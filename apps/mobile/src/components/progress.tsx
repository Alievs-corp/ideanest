/**
 * The funding bar moved into the UI kit — issue #151. It lives in `ui/progress.tsx` now, with the
 * `size` and the funded glow the web has, and a fill that scales instead of changing width.
 *
 * <p>Re-exported from here so the screens that import it by this path keep working until the
 * migration pull request moves them to `components/ui`.
 */
export {
  PROGRESS_FILL,
  ProgressBar,
  fillFraction,
  type ProgressBarProps,
  type ProgressBarSize,
} from './ui/progress';
