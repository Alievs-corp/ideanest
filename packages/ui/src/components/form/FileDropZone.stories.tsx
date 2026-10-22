import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Field } from './Field';
import { FileDropZone } from './FileDropZone';

const meta = {
  title: 'Form/FileDropZone',
  component: FileDropZone,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The picker button is not optional. Drag-and-drop is unreachable by keyboard, by switch control, and on touch — dragging is the shortcut, the button is the control.',
      },
    },
  },
  args: {
    onFiles: () => {},
    accept: 'image/*',
    multiple: true,
    hint: 'PNG or JPG, up to 8 MB each.',
  },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileDropZone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };

export const InAField: Story = {
  render: function InAFieldStory(args) {
    const [names, setNames] = useState<string[]>([]);
    return (
      <Field label="Campaign gallery" hint="The first image becomes the card thumbnail." grouped>
        <FileDropZone {...args} onFiles={(files) => setNames(files.map((f) => f.name))} />
        {names.length > 0 && (
          <ul className="mt-1 text-[13px] text-fg-64">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Field>
    );
  },
};
