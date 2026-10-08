import type { ProjectEdit, ProjectPatch } from '@ideanest/campaign-editor/contract';

/**
 * The project a form should be seeded from: the server's copy with everything the autosave still
 * holds unacknowledged laid over it (#162).
 *
 * A tab's form is rebuilt whenever its route mounts again — switch to Rewards and back — and the
 * cached project is only what the service last ANSWERED. A patch still in the air, or one that
 * failed and is kept for the retry, is newer than that; seeding without it would show the server's
 * value in the field while the failure alert says nothing typed was lost, and the next keystroke
 * elsewhere would send the old value back. A merge patch's keys are the project's own, so the
 * overlay is a spread.
 *
 * Use it through `useEditor().seed`, or directly with `autosave.unsaved`.
 */
export function withUnsaved(project: ProjectEdit, unsaved: ProjectPatch | null): ProjectEdit {
  if (unsaved === null) return project;
  const seeded = { ...project, ...unsaved } as ProjectEdit;
  // The one key that is not the project's own: the video is SENT as `videoMediaId` and read back
  // as `video` (#331). A removal still in the air is a project with no video. A new id cannot be
  // laid over here — only the service knows its address and poster — so that keeps the old video
  // until the save answers.
  if (unsaved.videoMediaId === null) seeded.video = null;
  return seeded;
}
