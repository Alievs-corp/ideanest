import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SectionBlock, StoryBlock } from '@ideanest/campaign-editor/story';
import { readVideoDuration } from '../../lib/media/videoDuration';
import { uploadVideo, type UploadedVideo } from '../../lib/media/videoUpload';
import { STORY_COPY } from '../../test-editor-copy';
import { SectionFields } from './StorySectionFields';

vi.mock('../../lib/media/videoUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/media/videoUpload')>()),
  uploadVideo: vi.fn(),
  resumeVideo: vi.fn(),
}));
vi.mock('../../lib/media/videoDuration', () => ({ readVideoDuration: vi.fn() }));

/**
 * A section's video (#551): the campaign video's field, in the section, instead of its picture.
 * What is pinned is the one-or-the-other rule and what reaches the document — the clip's
 * measured fields, without the placeholder the story has no key for.
 */

const CLIP: UploadedVideo = {
  mediaId: '7d3e2f10-2c4b-4f8a-8e1d-5b9c0a6e4f21',
  url: 'https://cdn.example.test/media/7d3e2f10.mp4',
  posterUrl: 'https://cdn.example.test/media/7d3e2f10.poster.webp',
  width: 1280,
  height: 720,
  durationMs: 42_000,
  blurDataUrl: null,
};

const SECTION: SectionBlock = {
  type: 'section',
  id: 'our-workshop',
  title: 'Our workshop',
  image: null,
  video: null,
  spans: [],
};

afterEach(cleanup);

function show(block: SectionBlock, onChange: (block: StoryBlock) => void = () => undefined) {
  return render(
    <SectionFields
      copy={STORY_COPY.blocks}
      toolbar={STORY_COPY.toolbar}
      block={block}
      name="Section 1 of 1: Our workshop"
      disabled={false}
      invalid={false}
      describedBy={undefined}
      altDescribedBy={undefined}
      onChange={onChange}
      anchorsInUse={[]}
    />,
  );
}

describe('a section video', () => {
  it('offers a picture and a clip while the section has neither, and stores the clip it uploads', async () => {
    vi.mocked(readVideoDuration).mockResolvedValue(42_000);
    vi.mocked(uploadVideo).mockResolvedValue(CLIP);
    const onChange = vi.fn();
    const { container } = show(SECTION, onChange);

    expect(container.querySelector('input[accept="image/*"]')).not.toBeNull();
    expect(screen.getByText(/One clip of up to 60 seconds/)).toBeInTheDocument();

    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="video"]');
    if (input === null) throw new Error('The section has no video input');
    fireEvent.change(input, { target: { files: [new File(['bytes'], 'clip.mp4', { type: 'video/mp4' })] } });
    await act(async () => {
      await Promise.resolve();
    });
    await screen.findByText(STORY_COPY.blocks.sectionBlock.video.set);

    expect(onChange).toHaveBeenLastCalledWith({
      ...SECTION,
      image: null,
      video: {
        mediaId: CLIP.mediaId,
        url: CLIP.url,
        posterUrl: CLIP.posterUrl,
        width: 1280,
        height: 720,
        durationMs: 42_000,
      },
    });
  });

  it('shows a section with a video its clip and no picture field, and removes it', () => {
    const onChange = vi.fn();
    const { container } = show(
      {
        ...SECTION,
        video: {
          mediaId: CLIP.mediaId,
          url: CLIP.url,
          posterUrl: CLIP.posterUrl,
          width: 1280,
          height: 720,
          durationMs: 42_000,
        },
      },
      onChange,
    );

    expect(container.querySelector('input[accept="image/*"]')).toBeNull();
    expect(screen.getByLabelText('Preview of the video of Section 1 of 1: Our workshop')).toHaveAttribute(
      'poster',
      CLIP.posterUrl,
    );

    fireEvent.click(screen.getByRole('button', { name: STORY_COPY.blocks.sectionBlock.video.remove }));
    expect(onChange).toHaveBeenLastCalledWith({ ...SECTION, video: null });
  });

  it('offers no clip while the section has a picture', () => {
    const { container } = show({
      ...SECTION,
      image: { url: 'https://cdn.example.test/w.jpg', width: 1440, height: 960, alt: 'The bench' },
    });

    expect(container.querySelector('input[type="file"][accept*="video"]')).toBeNull();
    expect(container.querySelector('input[accept="image/*"]')).not.toBeNull();
  });
});
