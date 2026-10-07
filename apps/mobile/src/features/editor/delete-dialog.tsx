import type { RefObject } from 'react';
import { Dialog, Pill } from '../../components/ui';

/**
 * "Delete {name}?" — the web editor's delete confirmation (rewards, items, questions), as the
 * kit's white `Dialog` (#162).
 *
 * <h2>Contract</h2>
 *
 * `open`; `title` ("Delete Mug?", the caller's own template filled); `description` ("This cannot
 * be undone."); `deleteLabel` and `keepLabel` ("Delete", "Keep it") — all from the caller's panel
 * copy, so each tab keeps its own words. `onDelete` runs the deletion; `deleting` is true while it
 * is in flight (the Delete pill spins and nothing else can be pressed); `onKeep` closes it.
 * `returnFocusTo` is the control that opened it.
 *
 * <p>It cannot be dismissed by the backdrop and has no corner X: a destructive choice is made with
 * one of the two buttons. Delete is the kit's `danger` pill and comes first, as the kit stacks a
 * dialog's primary action; "Keep it" is the ghost way out under it.
 */
export interface DeleteDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly deleteLabel: string;
  readonly keepLabel: string;
  readonly deleting: boolean;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
  readonly returnFocusTo?: RefObject<unknown>;
  readonly testID?: string;
}

export function DeleteDialog({
  open,
  title,
  description,
  deleteLabel,
  keepLabel,
  deleting,
  onDelete,
  onKeep,
  returnFocusTo,
  testID = 'delete-dialog',
}: DeleteDialogProps) {
  return (
    <Dialog
      open={open}
      // Android back and the iOS escape gesture keep it, except mid-deletion.
      onClose={() => {
        if (!deleting) onKeep();
      }}
      title={title}
      description={description}
      showClose={false}
      dismissOnScrim={false}
      returnFocusTo={returnFocusTo}
      testID={testID}
      footer={
        <>
          <Pill
            label={deleteLabel}
            variant="danger"
            fullWidth
            busy={deleting}
            disabled={deleting}
            onPress={onDelete}
            testID={`${testID}-delete`}
          />
          <Pill
            label={keepLabel}
            variant="ghost"
            fullWidth
            disabled={deleting}
            onPress={onKeep}
            testID={`${testID}-keep`}
          />
        </>
      }
    />
  );
}
