import { loadFont } from '@remotion/google-fonts/Inter';

export const { fontFamily } = loadFont('normal', {
  weights: ['600', '800'],
  subsets: ['latin', 'latin-ext', 'cyrillic'],
});
