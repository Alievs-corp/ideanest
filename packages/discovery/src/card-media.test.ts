import { describe, expect, it } from 'vitest';
import { cardCoverFrom } from './card-media';

const IMAGE = { url: 'https://cdn.example/cover.jpg', width: 1600, height: 900 };
const VIDEO = {
  url: 'https://cdn.example/clip.mp4',
  posterUrl: 'https://cdn.example/poster.jpg',
  width: 1280,
  height: 720,
};

describe('cardCoverFrom', () => {
  it('covers a campaign that has a video with the video’s own poster', () => {
    expect(cardCoverFrom({ image: IMAGE, video: VIDEO })).toEqual({
      url: VIDEO.posterUrl,
      width: 1280,
      height: 720,
      video: VIDEO,
    });
  });

  it('draws the uploaded cover when there is no video', () => {
    expect(cardCoverFrom({ image: IMAGE })).toEqual({ ...IMAGE, video: null });
    expect(cardCoverFrom({ image: IMAGE, video: null })).toEqual({ ...IMAGE, video: null });
  });

  it('treats an incomplete video as none, so no clip previews without a still', () => {
    expect(cardCoverFrom({ image: IMAGE, video: { ...VIDEO, posterUrl: null } })).toEqual({ ...IMAGE, video: null });
    expect(cardCoverFrom({ image: IMAGE, video: { ...VIDEO, width: 0 } })).toEqual({ ...IMAGE, video: null });
  });

  it('has nothing to draw for a campaign with neither', () => {
    expect(cardCoverFrom({})).toEqual({ url: null, width: null, height: null, video: null });
    expect(cardCoverFrom({ image: { url: '' } })).toEqual({ url: null, width: null, height: null, video: null });
  });
});
