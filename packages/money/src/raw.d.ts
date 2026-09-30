/** Vite's `?raw` import: a file's own text. Declared here because this package does not load Vite's client types. */
declare module '*?raw' {
  const content: string;
  export default content;
}
