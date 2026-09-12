'use client';

import type { ReactNode } from 'react';
import { Pill } from '@ideanest/ui';
import { Drawer } from '@ideanest/ui/motion';

/**
 * A drawer with a cancel and a save in its footer.
 *
 * Both reward editors need exactly this, and the footer is where the save model
 * lives — one place decides the wording of the button, that it is unavailable
 * while a request is in flight, and that cancelling is offered first.
 *
 * <h3>A DRAWER, NOT A MODAL</h3>
 *
 * A modal stops the page; a drawer is an extension of it (docs/ui-kit.md
 * §7.14). Writing a reward tier is work done against the list behind it — which
 * items exist, what the other tiers are priced at — and the dark surface keeps
 * that list legible behind the panel instead of covering it with white.
 *
 * <h3>THE SAVE IS WHITE, NOT LIME</h3>
 *
 * Lime means *urgent*, "act now" (docs/ui-kit.md §2.3), and saving a draft
 * reward is not urgent. `primary` is the white pill: the main action, sitting
 * above the system. At most one accent element belongs on a screen and it is
 * not this one.
 *
 * <h3>IT CANNOT BE DISMISSED MID-SAVE</h3>
 *
 * Escape, the backdrop, and the close control are all withdrawn while a request
 * is in flight. The answer still has to be applied, and a creator who closed
 * the panel during the request would be left unable to tell whether it landed —
 * which on a price is a question they have to be able to answer.
 *
 * MOTION: the drawer's own entry, 200ms, transform only, collapsed entirely
 * under `prefers-reduced-motion`. Nothing here adds any (docs/motion-system.md
 * §5 gives the campaign editor "none").
 */
import type { EditorDrawerCopy } from '../../lib/i18n/campaign-editor-copy';

export interface EditorDrawerProps {
  /** The two buttons' words. */
  copy: EditorDrawerCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** True while the save is in flight. */
  saving: boolean;
  onSave: () => void;
  children: ReactNode;
}

export function EditorDrawer({
  copy,
  open,
  onOpenChange,
  title,
  description,
  saving,
  onSave,
  children,
}: EditorDrawerProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title={title}
      description={description}
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Pill variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Pill>
          <Pill variant="primary" disabled={saving} onClick={onSave}>
            {saving ? copy.saving : copy.save}
          </Pill>
        </div>
      }
    >
      {children}
    </Drawer>
  );
}
