import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Field } from './form/Field';
import { TextInput } from './form/TextInput';
import { Textarea } from './form/Textarea';
import { Select } from './form/Select';
import { CharacterCount, type CharacterCountCopy } from './form/CharacterCount';
import { Checkbox } from './form/Checkbox';
import { Radio, RadioGroup } from './form/Radio';
import { Switch } from './form/Switch';
import { FileDropZone } from './form/FileDropZone';

/**
 * Appearance is reviewed in Storybook. These tests cover the wiring that fails
 * silently: label association, description ids, aria state, and the DOM-only
 * properties that no attribute can express.
 */

describe('Field', () => {
  it('associates its label with the control inside it', () => {
    render(
      <Field label="Campaign title">
        <TextInput />
      </Field>,
    );
    expect(screen.getByLabelText('Campaign title')).toBe(screen.getByRole('textbox'));
  });

  it('describes the control with the hint AND the error when both are present', () => {
    render(
      <Field label="Title" hint="Sixty characters or fewer." error="Too long.">
        <TextInput />
      </Field>,
    );

    const input = screen.getByRole('textbox');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids).toHaveLength(2);

    const described = ids.map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Sixty characters or fewer.');
    expect(described).toContain('Too long.');
  });

  it('marks the control invalid only when there is an error', () => {
    const { rerender } = render(
      <Field label="Title" hint="A hint.">
        <TextInput />
      </Field>,
    );
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');

    rerender(
      <Field label="Title" hint="A hint." error="Required.">
        <TextInput />
      </Field>,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('carries the required marker through to the control', () => {
    render(
      <Field label="Title" required>
        <TextInput />
      </Field>,
    );
    expect(screen.getByRole('textbox')).toBeRequired();
  });

  it('names a grouped field without pointing htmlFor at nothing', () => {
    render(
      <Field label="Delivery" grouped>
        <RadioGroup>
          <Radio value="a" label="A" />
        </RadioGroup>
      </Field>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Delivery' })).toBeInTheDocument();
  });

  it('leaves a control outside a Field fully usable', () => {
    render(<TextInput aria-label="Search" invalid />);
    const input = screen.getByRole('textbox', { name: 'Search' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('TextInput', () => {
  it('forwards typing', async () => {
    const onChange = vi.fn();
    render(
      <Field label="Email">
        <TextInput onChange={onChange} />
      </Field>,
    );

    const input = screen.getByLabelText('Email');
    await userEvent.type(input, 'rowan@example.com');
    expect(input).toHaveValue('rowan@example.com');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Textarea', () => {
  it('inherits the Field wiring like any other control', () => {
    render(
      <Field label="Story" error="Say what the money is for.">
        <Textarea />
      </Field>,
    );
    const box = screen.getByLabelText('Story');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Select', () => {
  it('renders a real select whose placeholder cannot be chosen', async () => {
    render(
      <Field label="Category">
        <Select placeholder="Choose a category">
          <option value="games">Games</option>
          <option value="art">Art</option>
        </Select>
      </Field>,
    );

    const select = screen.getByLabelText('Category');
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Choose a category' })).toBeDisabled();

    await userEvent.selectOptions(select, 'art');
    expect(select).toHaveValue('art');
  });
});

describe('CharacterCount in a language that declines', () => {
  /*
   * Russian picks between three forms by the last digit, which is the case an
   * English singular/plural ternary gets wrong for most numbers with nothing on
   * screen to say so. The forms are the ones `messages/ru.json` carries.
   */
  const RU: CharacterCountCopy = {
    remaining: {
      one: 'Остался {count} символ',
      few: 'Осталось {count} символа',
      many: 'Осталось {count} символов',
      other: 'Осталось {count} символа',
    },
    tooMany: {
      one: 'На {count} символ больше',
      few: 'На {count} символа больше',
      many: 'На {count} символов больше',
      other: 'На {count} символа больше',
    },
  };

  it.each([
    [59, 'Остался 1 символ'],
    [57, 'Осталось 3 символа'],
    [55, 'Осталось 5 символов'],
    [39, 'Остался 21 символ'],
  ])('selects the Russian form for what is left after %i of 60', (count, expected) => {
    const { unmount } = render(
      <CharacterCount count={count} limit={60} copy={RU} locale="ru" />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
    unmount();
  });

  it('counts upwards past the limit, in the same three forms', () => {
    render(<CharacterCount count={65} limit={60} copy={RU} locale="ru" />);
    expect(screen.getByText('На 5 символов больше')).toBeInTheDocument();
    expect(screen.queryByText(/Осталось/u)).toBeNull();
  });

  it('needs no declension in Azerbaijani, which repeats one form', () => {
    const AZ: CharacterCountCopy = {
      remaining: {
        one: '{count} simvol qalıb',
        few: '{count} simvol qalıb',
        many: '{count} simvol qalıb',
        other: '{count} simvol qalıb',
      },
      tooMany: {
        one: '{count} simvol artıqdır',
        few: '{count} simvol artıqdır',
        many: '{count} simvol artıqdır',
        other: '{count} simvol artıqdır',
      },
    };

    render(<CharacterCount count={59} limit={60} copy={AZ} locale="az" />);
    expect(screen.getByText('1 simvol qalıb')).toBeInTheDocument();
  });

  it('falls back rather than throwing on a language tag Intl cannot parse', () => {
    /* A counter that took the field down over a locale string would be the worse failure. */
    render(<CharacterCount count={57} limit={60} copy={RU} locale="not a locale" />);
    expect(screen.getByText('Осталось 3 символа')).toBeInTheDocument();
  });
});

describe('Checkbox', () => {
  it('writes indeterminate to the DOM property, which no attribute can express', () => {
    const { rerender } = render(<Checkbox label="All rewards" indeterminate />);
    const box = screen.getByRole('checkbox', { name: 'All rewards' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);

    rerender(<Checkbox label="All rewards" indeterminate={false} />);
    expect(box.indeterminate).toBe(false);
  });

  it('toggles as a native checkbox', async () => {
    render(<Checkbox label="Email me" />);
    const box = screen.getByRole('checkbox', { name: 'Email me' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(box).toBeChecked();
  });
});

describe('Switch', () => {
  it('exposes switch semantics rather than checkbox semantics', () => {
    render(<Switch label="Allow late pledges" />);
    expect(screen.getByRole('switch', { name: 'Allow late pledges' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('toggles aria-checked and reports the new value', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Allow late pledges" onCheckedChange={onCheckedChange} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('honours a controlled checked prop', async () => {
    render(<Switch label="Locked" checked={false} onCheckedChange={() => {}} />);
    const toggle = screen.getByRole('switch');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

describe('RadioGroup', () => {
  it('has an accessible name', () => {
    render(
      <RadioGroup label="Delivery">
        <Radio value="digital" label="Digital only" />
      </RadioGroup>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Delivery' })).toBeInTheDocument();
  });

  it('deselects the sibling when another radio is chosen', async () => {
    render(
      <RadioGroup label="Delivery" defaultValue="standard">
        <Radio value="standard" label="Standard" />
        <Radio value="express" label="Express" />
      </RadioGroup>,
    );

    const standard = screen.getByRole('radio', { name: 'Standard' });
    const express = screen.getByRole('radio', { name: 'Express' });
    expect(standard).toBeChecked();

    await userEvent.click(express);
    expect(express).toBeChecked();
    expect(standard).not.toBeChecked();
  });

  it('reports the chosen value', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup label="Delivery" onValueChange={onValueChange}>
        <Radio value="digital" label="Digital only" />
      </RadioGroup>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Digital only' }));
    expect(onValueChange).toHaveBeenCalledWith('digital');
  });
});

describe('FileDropZone', () => {
  const file = () => new File(['x'], 'cover.png', { type: 'image/png' });

  it('offers a keyboard-reachable trigger with an accessible name', async () => {
    render(<FileDropZone onFiles={() => {}} />);
    const button = screen.getByRole('button', { name: 'Choose files' });

    await userEvent.tab();
    expect(button).toHaveFocus();
  });

  it('opens the picker from the button and reports the chosen files', async () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDropZone onFiles={onFiles} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file());

    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]?.[0]?.[0]?.name).toBe('cover.png');
  });

  it('reports files from a drop', () => {
    const onFiles = vi.fn();
    render(<FileDropZone onFiles={onFiles} />);
    const zone = screen.getByRole('group');

    fireEvent.drop(zone, { dataTransfer: { files: [file()] } });

    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]?.[0]?.[0]?.name).toBe('cover.png');
  });

  it('does not drop out of the drag state when the pointer crosses a child', () => {
    render(<FileDropZone onFiles={() => {}} prompt="Drag files here" dragPrompt="Release" />);
    const zone = screen.getByRole('group');
    const child = screen.getByRole('button', { name: 'Choose files' });

    fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
    expect(screen.getByText('Release')).toBeInTheDocument();

    // Entering a child fires dragleave on the parent; a naive handler clears here.
    fireEvent.dragEnter(child, { dataTransfer: { files: [] } });
    fireEvent.dragLeave(zone, { dataTransfer: { files: [] } });
    expect(screen.getByText('Release')).toBeInTheDocument();

    fireEvent.dragLeave(child, { dataTransfer: { files: [] } });
    expect(screen.getByText('Drag files here')).toBeInTheDocument();
  });
});

describe('CharacterCount', () => {
  it('keeps the visible number out of the accessibility tree', () => {
    render(<CharacterCount count={10} limit={60} />);

    // Sighted creators need it at all times; a screen reader needs it only once
    // it starts to matter. The two are served by different elements.
    expect(screen.getByText('50 characters remaining')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says nothing at all while the limit is far away', async () => {
    vi.useFakeTimers();
    try {
      render(<CharacterCount count={10} limit={60} announceWithin={20} />);
      await vi.advanceTimersByTimeAsync(5000);

      expect(screen.getByRole('status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the remainder politely once it is close, after a pause', async () => {
    vi.useFakeTimers();
    try {
      render(<CharacterCount count={55} limit={60} announceWithin={20} announceDelayMs={1000} />);

      // Announcing on the keystroke talks over the typing echo, so nothing is
      // said until the count has settled.
      expect(screen.getByRole('status')).toHaveTextContent('');

      // Wrapped, because the announcement is a state update the timer causes
      // rather than one an event causes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      const live = screen.getByRole('status');
      expect(live).toHaveTextContent('5 characters remaining');
      expect(live).toHaveAttribute('aria-live', 'polite');
    } finally {
      vi.useRealTimers();
    }
  });

  it('changes the words, not only the colour, once the limit is passed', async () => {
    vi.useFakeTimers();
    try {
      render(<CharacterCount count={63} limit={60} />);
      // Wrapped, because the announcement is a state update the timer causes
      // rather than one an event causes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // Both the visible line and the announcement say it, which is the point.
      expect(screen.getAllByText('3 characters too many')).toHaveLength(2);
      expect(screen.getByRole('status')).toHaveTextContent('3 characters too many');
    } finally {
      vi.useRealTimers();
    }
  });
});
