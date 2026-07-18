/// <reference types="vite/client" />

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string
  export default url
}

// CSS Custom Highlight API (supported by Electron's Chromium, missing in TS libs)
declare class Highlight {
  constructor(...ranges: AbstractRange[])
}
declare namespace CSS {
  const highlights:
    | {
        set(name: string, highlight: Highlight): void
        delete(name: string): void
      }
    | undefined
}
