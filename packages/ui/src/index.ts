/* Primitives */
export { Card, CardTitle, CardSubtitle, CardFooter, type CardProps } from './components/Card/Card';
export { Pill, type PillProps } from './components/Pill/Pill';
export {
  Chip,
  ChipRow,
  RemovableChip,
  type ChipProps,
  type ChipRowProps,
  type RemovableChipProps,
} from './components/Chip/Chip';
export { IconButton, type IconButtonProps } from './components/IconButton/IconButton';
export { ExpandButton, type ExpandButtonProps } from './components/IconButton/ExpandButton';
export { Tag, type TagProps } from './components/Tag/Tag';
export {
  Avatar,
  AvatarGroup,
  type AvatarProps,
  type AvatarGroupProps,
} from './components/Avatar/Avatar';
export { ProgressBar, type ProgressBarProps } from './components/ProgressBar/ProgressBar';
export { StatBlock, StatRow, type StatBlockProps } from './components/StatBlock/StatBlock';
export { DotIndicator, type DotIndicatorProps } from './components/DotIndicator/DotIndicator';
export { FloatingPanel, type FloatingPanelProps } from './components/FloatingPanel/FloatingPanel';
export {
  RailHeader,
  CardRail,
  type RailHeaderProps,
  type CardRailProps,
} from './components/RailHeader/RailHeader';

/* Layout */
export { Rail, RailItem, type RailProps, type RailItemProps } from './layout/Rail';
export { TopBar, TopBarLink, type TopBarProps } from './layout/TopBar';
export { Timeline, type TimelineProps, type TimelineMarker } from './layout/Timeline';

/* Motion
 *
 * `FadeUp`, `StaggerGroup` and `CountUp` are NOT here. They drive `motion`, and
 * a static re-export of them from this barrel put 116 kB of animation runtime
 * into the first load of every route that imported anything from this package
 * — including the checkout, which animates nothing. They live behind
 * `@ideanest/ui/motion`, and `src/motion.ts` explains the measurement.
 *
 * `FlipButton` stays because it animates in CSS and costs nothing. */
export { FlipButton, type FlipButtonProps } from './motion/FlipButton';

/* Form */
export {
  Field,
  useFieldControl,
  useFieldGroup,
  type FieldProps,
  type FieldControlAria,
  type FieldControlOwnProps,
  type FieldGroupAria,
} from './components/form/Field';
export { TextInput, type TextInputProps } from './components/form/TextInput';
export { Textarea, type TextareaProps } from './components/form/Textarea';
export { Select, type SelectProps } from './components/form/Select';
export {
  CharacterCount,
  CHARACTER_COUNT_COPY_EN,
  type CharacterCountProps,
  type CharacterCountCopy,
  type PluralForms,
} from './components/form/CharacterCount';
export { Checkbox, type CheckboxProps } from './components/form/Checkbox';
export {
  Radio,
  RadioGroup,
  type RadioProps,
  type RadioGroupProps,
} from './components/form/Radio';
export { Switch, type SwitchProps } from './components/form/Switch';
export { FileDropZone, type FileDropZoneProps } from './components/form/FileDropZone';

/* Overlay
 *
 * `Modal`, `Drawer`, `Popover`, `Tooltip` and the toast pair animate, so they
 * are behind `@ideanest/ui/motion` with the rest of the `motion` consumers.
 * What is left here is the overlay machinery that does not animate: `Combobox`,
 * whose popup docs/motion-system.md §5.1 requires to appear and disappear
 * outright, and the hooks and geometry the animated ones are built from. */
export {
  Combobox,
  type ComboboxProps,
  type ComboboxOption,
} from './components/overlay/Combobox';
export { useFocusTrap, tabbableElements } from './components/overlay/useFocusTrap';
export { useDismiss, useScrollLock, useBackdropDismiss } from './components/overlay/useDismiss';
export {
  resolvePlacement,
  rectOf,
  type Placement,
  type Position,
  type Rect,
} from './components/overlay/placement';

/* Data display */
export {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  type TableProps,
  type TableRowProps,
  type TableHeaderCellProps,
  type TableCellProps,
  type TableSort,
} from './components/data/Table';
export { Pagination, type PaginationProps } from './components/data/Pagination';
export { EmptyState, type EmptyStateProps } from './components/data/EmptyState';
export {
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  SkeletonCard,
  type SkeletonProps,
  type SkeletonGroupProps,
  type SkeletonTextProps,
  type SkeletonCardProps,
} from './components/data/Skeleton';
export { InlineAlert, type InlineAlertProps } from './components/data/InlineAlert';

/* Media
 *
 * Framework-independent on purpose: `next/image` cannot be imported here, so
 * the frame takes the image as a child and the application supplies whichever
 * element knows how to fetch AVIF. See `components/media/Media.tsx`. */
export {
  Media,
  MediaFrame,
  MEDIA_RATIOS,
  aspectRatioOf,
  isPlaceholderUri,
  type MediaProps,
  type MediaFrameProps,
  type MediaRatio,
  type MediaRatioToken,
  type MediaRadius,
  type IntrinsicSize,
} from './components/media/Media';

export { cn } from './lib/cn';
