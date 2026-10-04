import type { ReactElement } from 'react';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import type { GlyphNode, IconGlyph, IconVariant } from '../../icons';
import { colors } from '../../theme';

/**
 * An icon — Iconsax, generated into `src/icons` (issue #274, `mobile-design` skill §5).
 *
 * <h2>Variants have jobs</h2>
 *
 * `linear` is the default: inline beside text and in dense rows. `bold` marks a selected state.
 * `bulk` is for feature and action icons — circular buttons, empty states. Bulk's second layer
 * is the same colour at reduced opacity, so it never needs a second colour.
 *
 * <h2>Decorative unless named</h2>
 *
 * Almost every icon in the product sits beside words that already say what it means: the alert
 * icon next to the alert, the arrow next to "12% more". Announcing it as well is noise — VoiceOver
 * reading "image" before every sentence. So an icon is hidden from assistive technology by
 * default, and one that carries meaning on its own (which should be rare, and is never allowed on
 * a control: `IconButton` takes a required `label` instead) is given a `label` here.
 *
 * <p>The component takes the glyph itself rather than a name string, so a typo is a type error and
 * the bundle carries only the glyphs that are generated.
 */
export type IconComponent = IconGlyph;

export interface IconProps {
  readonly icon: IconComponent;
  readonly variant?: IconVariant;
  readonly size?: number;
  /** A token colour. Defaults to primary text; controls pass the colour of their own label. */
  readonly color?: string;
  /** Present only when the icon alone carries meaning. */
  readonly label?: string;
}

const ELEMENTS = {
  path: Path,
  circle: Circle,
  rect: Rect,
  g: G,
  line: Line,
  ellipse: Ellipse,
  polygon: Polygon,
  polyline: Polyline,
} as const;

function draw(nodes: readonly GlyphNode[], prefix: string): ReactElement[] {
  return nodes.map((node, index) => {
    const Element = ELEMENTS[node.el] as unknown as (props: Record<string, unknown>) => ReactElement;
    const key = `${prefix}${index}`;
    return (
      <Element key={key} {...node.attrs}>
        {node.children === undefined ? undefined : draw(node.children, `${key}.`)}
      </Element>
    );
  });
}

export function Icon({
  icon: glyph,
  variant = 'linear',
  size = 18,
  color = colors.textPrimary,
  label,
}: IconProps) {
  const named = label !== undefined && label !== '';
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      color={color}
      testID={`icon-${glyph.name}`}
      accessible={named}
      accessibilityLabel={named ? label : undefined}
      accessibilityRole={named ? 'image' : undefined}
      accessibilityElementsHidden={!named}
      importantForAccessibility={named ? 'yes' : 'no-hide-descendants'}
    >
      {draw(glyph[variant], '')}
    </Svg>
  );
}
