/**
 * The native UI kit — issue #151. The React Native half of `@ideanest/ui`, drawn from the same
 * tokens, one component per file.
 *
 * <p>Screens import from here. The sections follow `packages/ui`'s own grouping so a component
 * can be found by the name it has on the web.
 */

/* Foundations: surfaces, motion, focus, feedback ---------------------------------------------- */
export { announce } from './announce';
export { useFocusRing } from './focus';
export { haptics, type HapticEvent } from './haptics';
export { Icon, type IconComponent, type IconProps } from './icon';
export {
  MotionBudgetProvider,
  useMotionAllowed,
  useMotionBudget,
  useReducedMotion,
  type MotionLevel,
} from './motion-budget';
export {
  SurfaceProvider,
  TONES,
  focusRingColor,
  useSurface,
  type RelativeTone,
  type Surface,
} from './surface';

/* Typography ----------------------------------------------------------------------------------- */
export {
  Body,
  Caption,
  CardTitle,
  Display,
  Eyebrow,
  Heading,
  Meta,
  Story,
  Subheading,
  toneColor,
  type TextProps,
  type Tone,
} from '../text';

/* Actions -------------------------------------------------------------------------------------- */
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from './icon-button';
export { AccentScopeProvider, Pill, type PillProps, type PillSize, type PillVariant } from './pill';

/* Primitives: Tag, Chip, Card, Avatar, ProgressBar, StatBlock, FloatingPanel ------------------ */
export { Avatar, initials, type AvatarProps, type AvatarSize } from './avatar';
export { Card, type CardProps, type CardSize, type CardVariant } from './card';
export {
  Chip,
  ChipRow,
  RemovableChip,
  type ChipProps,
  type ChipRowProps,
  type RemovableChipProps,
} from './chip';
export { FloatingPanel, type FloatingPanelProps } from './floating-panel';
export {
  PROGRESS_FILL,
  ProgressBar,
  fillFraction,
  type ProgressBarProps,
  type ProgressBarSize,
} from './progress';
export {
  StatBlock,
  StatRow,
  type StatBlockProps,
  type StatBlockSize,
  type StatTrend,
} from './stat-block';
export { Tag, type TagProps, type TagVariant } from './tag';

/* Data and media: InlineAlert, EmptyState, ErrorState, Skeleton, Media, Screen ----------------- */
export { EmptyState, ErrorState, type EmptyStateProps, type ErrorStateProps } from './empty-state';
export { InlineAlert, type InlineAlertProps, type InlineAlertVariant } from './inline-alert';
export {
  MEDIA_RATIOS,
  Media,
  MediaFrame,
  aspectRatioOf,
  isPlaceholderUri,
  type IntrinsicSize,
  type MediaAlt,
  type MediaFrameProps,
  type MediaProps,
  type MediaRadius,
  type MediaRatio,
  type MediaRatioToken,
} from './media';
export { Screen, type ScreenProps } from './screen';
export {
  SKELETON_SHIMMER,
  Skeleton,
  SkeletonCard,
  SkeletonCrossfade,
  SkeletonGroup,
  type SkeletonCrossfadeProps,
  type SkeletonGroupProps,
  type SkeletonProps,
} from './skeleton';

/* Form: Field, TextInput, PasswordInput, Textarea, Select, CharacterCount, Checkbox, Radio,
 * Switch, FilePicker, SearchField ------------------------------------------------------------- */

/* Overlay: Dialog, Sheet ---------------------------------------------------------------------- */
