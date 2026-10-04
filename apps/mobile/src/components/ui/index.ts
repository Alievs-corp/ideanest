/**
 * The native UI kit — issue #151. The React Native half of `@ideanest/ui`, drawn from the same
 * tokens, one component per file.
 *
 * <p>Screens import from here. The sections follow `packages/ui`'s own grouping so a component
 * can be found by the name it has on the web.
 */

/* Foundations: surfaces, motion, focus, feedback ---------------------------------------------- */
export { announce } from './announce';
export { useAssistiveTechnology } from './assistive-tech';
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
  AnimatedAmount,
  countFrame,
  type AnimatedAmountMode,
  type AnimatedAmountProps,
} from './animated-amount';
export { PressableScale, usePressScale, type PressableScaleProps } from './press-scale';
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
export {
  AmountKeypad,
  type AmountKeypadHandle,
  type AmountKeypadProps,
  type KeypadSettle,
} from './amount-keypad';
export {
  SWIPE_COMMIT,
  SwipeToConfirm,
  swipeCommits,
  swipeProgress,
  type SwipeToConfirmProps,
} from './swipe-to-confirm';
export {
  SegmentedPill,
  type SegmentOption,
  type SegmentedPillProps,
} from './segmented-pill';

/* Primitives: Tag, Chip, Card, Avatar, ProgressBar, StatBlock, FloatingPanel ------------------ */
export { AccentCard, type AccentCardProps } from './accent-card';
export { Avatar, initials, type AvatarProps, type AvatarSize } from './avatar';
export {
  AVATAR_STACK_MAX,
  AvatarStack,
  SourceDot,
  type AvatarStackProps,
  type SourceDotProps,
  type StackPerson,
} from './avatar-stack';
export { Card, type CardProps, type CardSize, type CardVariant } from './card';
export { HeroFigure, minorStart, type HeroFigureProps, type HeroFigureSize } from './hero-figure';
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
export { ContentSheet, type ContentSheetProps } from './content-sheet';
export { EdgeFade, type EdgeFadeProps } from './edge-fade';
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
export { Screen, type ScreenError, type ScreenProps } from './screen';
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
export { CharacterCount, type CharacterCountProps } from './character-count';
export { Checkbox, type CheckboxProps } from './checkbox';
export { Field, useFieldControl, type FieldProps } from './field';
export {
  FilePicker,
  type FilePickerMessages,
  type FilePickerProps,
  type PickedFile,
} from './file-picker';
export { PasswordInput, type PasswordInputProps } from './password-input';
export { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from './radio';
export { SearchField, type SearchFieldProps, type SearchSuggestion } from './search-field';
export { Select, type SelectOption, type SelectProps } from './select';
export { Switch, type SwitchProps } from './switch';
export { TextInput, type TextInputProps, type TextInputSize } from './text-input';
export { Textarea, type TextareaProps } from './textarea';

/* Overlay: Dialog, Sheet ---------------------------------------------------------------------- */
export { Dialog, type DialogProps } from './dialog';
export { SHEET_PAGE_SCALE, Sheet, SheetHost, type SheetProps } from './sheet';
export { REVEAL_TOTAL_MS, SuccessReveal, type SuccessRevealProps } from './success-reveal';

/* Navigation motion: SharedTransition, CardStack ---------------------------------------------- */
export {
  CardStack,
  LAYER_SCALE,
  PEEK,
  STACK_DEPTH,
  stackHeight,
  type CardStackItem,
  type CardStackProps,
} from './card-stack';
export {
  ARRIVAL_WINDOW_MS,
  SharedTarget,
  SharedTransitionHost,
  sharedMeasure,
  useSharedArrival,
  useSharedSnapshot,
  useSharedSource,
  useSharedTargetDisplay,
  type SharedFrame,
  type SharedSnapshot,
  type SharedSource,
  type SharedTargetProps,
} from './shared-transition';
