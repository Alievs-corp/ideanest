import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StructuredData } from './StructuredData';

function script(container: HTMLElement): HTMLScriptElement | null {
  return container.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
}

describe('StructuredData', () => {
  it('writes one block a parser can read', () => {
    const { container } = render(
      <StructuredData nodes={[{ '@type': 'Organization', name: 'IdeyaNest' }]} />,
    );

    const block = script(container);
    expect(block).not.toBeNull();
    expect(JSON.parse(block?.textContent ?? '')).toEqual({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', name: 'IdeyaNest' }],
    });
  });

  it('writes nothing at all when there is nothing to claim', () => {
    const { container } = render(<StructuredData nodes={[]} />);
    expect(script(container)).toBeNull();
  });

  it('cannot be closed early by a campaign title that carries a closing tag', () => {
    const { container } = render(
      <StructuredData
        nodes={[{ '@type': 'Product', name: '</script><img src=x onerror=alert(1)>' }]}
      />,
    );

    const block = script(container);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(block?.innerHTML).not.toContain('<');

    const parsed = JSON.parse(block?.textContent ?? '') as {
      '@graph': readonly { name: string }[];
    };
    expect(parsed['@graph'][0]?.name).toBe('</script><img src=x onerror=alert(1)>');
  });
});
