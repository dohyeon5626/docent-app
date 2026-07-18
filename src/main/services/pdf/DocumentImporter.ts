import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'doc', 'pages']

type Lang = 'ko' | 'en'

const MSG: Record<Lang, Record<'unsupported' | 'pagesOpen' | 'pagesNoPreview' | 'pagesExtract' | 'sofficeNeeded' | 'noOutput', string>> = {
  ko: {
    unsupported: '지원하지 않는 문서 형식입니다',
    pagesOpen: 'Pages 파일을 열 수 없습니다.',
    pagesNoPreview:
      '이 Pages 파일에는 PDF 미리보기가 없습니다. Pages에서 "파일 > 내보내기 > PDF"로 저장한 뒤 사용해 주세요.',
    pagesExtract: 'Pages 미리보기 추출에 실패했습니다.',
    sofficeNeeded:
      'Word 문서를 변환하려면 LibreOffice가 필요합니다. 터미널에서 `brew install --cask libreoffice`로 설치하거나, PDF로 내보낸 뒤 사용해 주세요.',
    noOutput: '변환된 PDF를 찾을 수 없습니다.'
  },
  en: {
    unsupported: 'Unsupported document format',
    pagesOpen: 'Could not open the Pages file.',
    pagesNoPreview:
      'This Pages file has no embedded PDF preview. In Pages, use File > Export To > PDF and try again.',
    pagesExtract: 'Failed to extract the Pages preview.',
    sofficeNeeded:
      'Converting Word documents requires LibreOffice. Install it with `brew install --cask libreoffice`, or export to PDF first.',
    noOutput: 'The converted PDF could not be found.'
  }
}

export function needsConversion(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() !== '.pdf'
}

/**
 * Converts a Word/Pages document to PDF so the rest of the pipeline
 * (rendering, page anchors, spotlight) works unchanged.
 */
export async function convertToPdf(
  srcPath: string,
  outDir: string,
  lang: Lang = 'ko'
): Promise<string> {
  const ext = path.extname(srcPath).toLowerCase()
  await fs.mkdir(outDir, { recursive: true })
  if (ext === '.pages') return extractPagesPreview(srcPath, outDir, MSG[lang])
  if (ext === '.docx' || ext === '.doc') return convertWithLibreOffice(srcPath, outDir, MSG[lang])
  throw new Error(`${MSG[lang].unsupported}: ${ext}`)
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (err += String(d)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }))
  })
}

/** .pages packages are zips that usually embed a full QuickLook preview PDF. */
async function extractPagesPreview(
  srcPath: string,
  outDir: string,
  msg: Record<string, string>
): Promise<string> {
  const listing = await run('unzip', ['-Z1', srcPath]).catch(() => null)
  if (!listing || listing.code !== 0) {
    throw new Error(msg.pagesOpen)
  }
  const entry = listing.out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /(^|\/)preview\.pdf$/i.test(l))
  if (!entry) {
    throw new Error(msg.pagesNoPreview)
  }
  const dest = path.join(outDir, 'source.pdf')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('unzip', ['-p', srcPath, entry])
    const ws = createWriteStream(dest)
    child.stdout.pipe(ws)
    child.on('error', reject)
    ws.on('error', reject)
    child.on('close', (code) => {
      ws.close()
      if (code === 0) resolve()
      else reject(new Error(msg.pagesExtract))
    })
  })
  return dest
}

/** Word documents convert via LibreOffice when it's installed. */
async function convertWithLibreOffice(
  srcPath: string,
  outDir: string,
  msg: Record<string, string>
): Promise<string> {
  const candidates = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/local/bin/soffice',
    'soffice'
  ]
  const soffice = candidates.find((c) => c === 'soffice' || existsSync(c))
  const result = await run(soffice ?? 'soffice', [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    srcPath
  ]).catch(() => null)
  if (!result || result.code !== 0) {
    throw new Error(msg.sofficeNeeded)
  }
  const produced = path.join(
    outDir,
    `${path.basename(srcPath, path.extname(srcPath))}.pdf`
  )
  const dest = path.join(outDir, 'source.pdf')
  await fs.rename(produced, dest).catch(async () => {
    // some versions report success but keep the original name
    if (!existsSync(dest)) throw new Error(msg.noOutput)
  })
  return dest
}
