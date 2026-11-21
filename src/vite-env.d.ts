/// <reference types="vite/client" />

declare module '*.wasm?url' {
  const src: string;
  export default src;
}

declare module '*.mjs?url' {
  const src: string;
  export default src;
}
