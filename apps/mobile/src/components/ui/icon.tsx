import type { LucideIcon } from 'lucide-react-native';
import { colors } from '../../theme';

/**
 * An icon — `lucide-react-native`, the same family and the same names as the web's
 * `lucide-react`, so a `CircleAlert` on a phone is the `CircleAlert` a designer drew on the web.
 *
 * <h2>Decorative unless named</h2>
 *
 * Almost every icon in the product sits beside words that already say what it means: the alert
 * icon next to the alert, the arrow next to "12% more". Announcing it as well is noise — VoiceOver
 * reading "image" before every sentence. So an icon is hidden from assistive technology by
 * default, and one that carries meaning on its own (which should be rare, and is never allowed on
 * a control: `IconButton` takes a required `label` instead) is given a `label` here.
 *
 * <p>The component takes the icon itself rather than a name string, so a typo is a type error and
 * the bundle carries only the icons that are imported.
 */
export type IconComponent = LucideIcon;

export interface IconProps {
  readonly icon: IconComponent;
  readonly size?: number;
  /** A token colour. Defaults to primary text; controls pass the colour of their own label. */
  readonly color?: string;
  /** Present only when the icon alone carries meaning. */
  readonly label?: string;
}

export function Icon({ icon: Glyph, size = 18, color = colors.textPrimary, label }: IconProps) {
  const named = label !== undefined && label !== '';
  return (
    <Glyph
      size={size}
      color={color}
      // Lucide's default. Named so the web and the phone stay the same weight of line.
      strokeWidth={2}
      accessible={named}
      accessibilityLabel={named ? label : undefined}
      accessibilityRole={named ? 'image' : undefined}
      accessibilityElementsHidden={!named}
      importantForAccessibility={named ? 'yes' : 'no-hide-descendants'}
    />
  );
}
