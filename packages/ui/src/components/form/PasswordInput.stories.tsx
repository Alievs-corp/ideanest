import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field } from './Field';
import { PasswordInput } from './PasswordInput';

const meta = {
  title: 'Form/PasswordInput',
  component: PasswordInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The input skin of `TextInput` with a reveal toggle in the trailing slot. The toggle carries `aria-pressed` and renames itself between "Show password" and "Hide password", so the state is never carried by the icon alone. Colour transitions only — authentication has no motion budget beyond 150ms on controls.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasswordInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { value: 'correct horse battery staple', readOnly: true } };
export const Empty: Story = {};
export const Disabled: Story = { args: { disabled: true, value: 'locked', readOnly: true } };

/** The refusal comes from the service, so the field is invalid without saying why itself. */
export const Invalid: Story = {
  args: { invalid: true, value: 'short', readOnly: true },
};

/** How both authentication forms use it: inside a `Field`, which owns the wiring. */
export const InAField: Story = {
  render: () => (
    <Field
      label="Password"
      required
      hint="Long is stronger than complicated. The exact requirement comes from the service if this one is refused."
    >
      <PasswordInput name="password" autoComplete="new-password" />
    </Field>
  ),
};
