import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',

    // A white canvas would misrepresent every component in a dark system.
    backgrounds: {
      options: {
        'surface-1': { name: 'surface-1 (page)', value: '#0D0D0D' },
        'surface-2': { name: 'surface-2 (card)', value: '#161616' },
        black: { name: 'black', value: '#000000' },
        white: { name: 'white (floating panel context)', value: '#FFFFFF' },
        light: { name: 'light theme page (pair with the Theme toolbar)', value: '#F4F4F1' },
      },
    },

    docs: {
      codePanel: true,
    },

    // Contrast failures are errors, not warnings. In this palette the
    // lime-on-white pairing measures 1.3:1 and is easy to miss by eye.
    a11y: {
      test: 'error',
    },
  },

  // docs/ui-kit.md §11: the same component under either theme's tokens.
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: {
    backgrounds: { value: 'surface-1' },
    theme: 'dark',
  },

  decorators: [
    (Story, context) => (
      <div
        data-theme={context.globals.theme === 'light' ? 'light' : 'dark'}
        className="font-sans text-fg antialiased"
      >
        <Story />
      </div>
    ),
  ],
};

export default preview;
