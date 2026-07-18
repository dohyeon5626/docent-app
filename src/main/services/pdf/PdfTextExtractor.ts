import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { PageText } from '@shared/types'

/** pdfjs asset dirs (CJK cMaps, fallback fonts) shipped in node_modules. */
const pdfjsAsset = (dir: string): string =>
  path.join(app.getAppPath(), 'node_modules', 'pdfjs-dist', dir) + path.sep

export interface ExtractedPdf {
  totalPages: number
  pages: PageText[]
  outline: { title: string; page: number; level: number }[]
}

/**
 * Extracts per-page text and the document outline using pdf.js (Node legacy
 * build, no worker). Runs in the main process; callers should treat it as a
 * long-running async task.
 */
export async function extractPdf(
  pdfPath: string,
  onProgress?: (page: number, total: number) => void
): Promise<ExtractedPdf> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(pdfPath))
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    cMapUrl: pdfjsAsset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAsset('standard_fonts')
  }).promise

  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pages.push({ page: i, text })
    page.cleanup()
    onProgress?.(i, doc.numPages)
  }

  const outline: ExtractedPdf['outline'] = []
  try {
    const raw = await doc.getOutline()
    const walk = async (items: typeof raw, level: number): Promise<void> => {
      for (const item of items ?? []) {
        let page = 0
        try {
          const dest =
            typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest
          if (dest?.[0]) page = (await doc.getPageIndex(dest[0])) + 1
        } catch {
          // unresolvable destination — keep the entry with page 0
        }
        outline.push({ title: item.title, page, level })
        await walk(item.items, level + 1)
      }
    }
    await walk(raw, 0)
  } catch {
    // no outline available
  }

  const totalPages = doc.numPages
  await doc.destroy()
  return { totalPages, pages, outline }
}
