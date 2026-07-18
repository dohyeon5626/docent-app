import { BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Mirrors the light-theme values from src/renderer/src/styles/global.css
// (--bg/--text/--hairline/etc. and the .study-doc/.doc-section/.md rules) so
// the exported PDF looks like what's on screen, not a separate print theme.
const PRINT_CSS = `
  :root {
    color-scheme: light;
    --bg: #ffffff;
    --bg-soft: #f5f5f7;
    --hairline: rgba(0, 0, 0, 0.1);
    --hairline-soft: rgba(0, 0, 0, 0.06);
    --text: #1d1d1f;
    --text-dim: #6e6e73;
    --accent: #3574d4;
    --tint: rgba(53, 116, 212, 0.09);
    --code-bg: rgba(0, 0, 0, 0.045);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 4px 6px 24px;
    font-family:
      -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Pretendard',
      'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    color: var(--text);
    background: var(--bg);
    font-size: 13.5px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .doc-section {
    padding: 22px 0 26px;
    border-bottom: 1px solid var(--hairline-soft);
    font-size: 13.5px;
    line-height: 1.85;
  }
  .doc-section:last-of-type { border-bottom: none; }
  .doc-caption {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 12px;
    break-after: avoid;
    page-break-after: avoid;
  }
  .doc-caption .title {
    font-size: 16.5px;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .doc-caption .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 8px;
    background: var(--bg-soft);
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .doc-section .md h1,
  .doc-section .md h2,
  .doc-section .md h3 {
    font-size: 14px;
    font-weight: 700;
    margin: 26px 0 8px;
    break-after: avoid;
    page-break-after: avoid;
  }
  .doc-section .md > :first-child,
  .doc-section .md h3:first-child { margin-top: 4px; }
  .doc-section .md p { margin: 12px 0; }
  .doc-section .md ul,
  .doc-section .md ol { margin: 12px 0 16px 19px; }
  .doc-section .md li { margin: 3.5px 0; }
  .doc-section .md li > ul,
  .doc-section .md li > ol { margin: 3px 0 3px 16px; }
  .doc-section .md strong { font-weight: 600; }
  .doc-section .md code {
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
  }
  .doc-section .md pre {
    background: var(--code-bg);
    border-radius: 12px;
    padding: 10px 13px;
    overflow-x: auto;
    margin: 8px 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .doc-section .md pre code { background: none; padding: 0; }
  .doc-section .md blockquote {
    border-left: 3px solid var(--hairline);
    padding-left: 11px;
    color: var(--text-dim);
    margin: 8px 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .doc-section .md table {
    border-collapse: separate;
    border-spacing: 0;
    margin: 14px 0;
    font-size: 12.5px;
    line-height: 1.6;
    border: 1px solid var(--hairline-soft);
    border-radius: 12px;
    overflow: hidden;
    width: 100%;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .doc-section .md th { background: var(--bg-soft); font-weight: 600; text-align: left; }
  .doc-section .md th,
  .doc-section .md td { padding: 6px 11px; border-bottom: 1px solid var(--hairline-soft); }
  .doc-section .md tr:last-child td { border-bottom: none; }
  .doc-section .md td + td,
  .doc-section .md th + th { border-left: 1px solid var(--hairline-soft); }

  .md mark {
    background: rgba(255, 235, 59, 0.42);
    color: inherit;
    padding: 0 2px;
    border-radius: 3px;
    font-weight: inherit;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .md mark.hl-red { background: rgba(255, 99, 92, 0.3); }
  .md mark.hl-green { background: rgba(52, 199, 89, 0.32); }
  .md mark.hl-blue { background: rgba(80, 155, 255, 0.3); }

  .md .note-big {
    display: inline-block;
    font-size: 16px;
    font-weight: 700;
    line-height: 1.5;
    letter-spacing: -0.01em;
    margin: 2px 0;
  }
  .md .note-small { font-size: 11.5px; color: var(--text-dim); }

  .mermaid-diagram {
    margin: 14px 0;
    padding: 14px 10px;
    background: var(--bg-soft);
    border-radius: 14px;
    display: flex;
    justify-content: center;
    overflow-x: auto;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .mermaid-diagram svg { max-width: 100%; height: auto; }

  .page-link {
    color: var(--accent);
    font-weight: 500;
    text-decoration: none;
  }

  .doc-section .md [data-page].anchored {
    border-radius: 8px;
    margin-left: -8px;
    margin-right: -8px;
    padding-left: 8px;
    padding-right: 8px;
  }
  .doc-section .md table[data-page].anchored { margin-left: 0; margin-right: 0; padding: 0; }
  .doc-section .md td[data-page].anchored,
  .doc-section .md th[data-page].anchored { margin: 0; padding: 6px 11px; border-radius: 0; }

  .md img { max-width: 100%; height: auto; break-inside: avoid; page-break-inside: avoid; }
`

const buildDocument = (title: string, sectionsHtml: string): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${sectionsHtml}
</body>
</html>`

const FOOTER_TEMPLATE = `
<div style="width: 100%; font-size: 9px; color: #aeaeb2; padding: 0 24px;
  display: flex; justify-content: space-between;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <span class="title"></span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`

/**
 * Renders the study summary document to a PDF buffer by loading a
 * self-contained HTML file (the already-rendered section markup, so
 * mermaid diagrams etc. come through as-is) into a hidden window.
 */
export async function renderSummaryPdf(title: string, sectionsHtml: string): Promise<Buffer> {
  const tmpFile = path.join(
    os.tmpdir(),
    `docent-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  )
  await fs.writeFile(tmpFile, buildDocument(title, sectionsHtml), 'utf-8')
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadFile(tmpFile)
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER_TEMPLATE,
      margins: { marginType: 'default' }
    })
  } finally {
    win.close()
    await fs.unlink(tmpFile).catch(() => {})
  }
}
