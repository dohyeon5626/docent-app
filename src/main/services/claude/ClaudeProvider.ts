import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import { app } from 'electron'
import type { AIProvider, AIRequestOptions } from './AIProvider'

type Lang = 'ko' | 'en'

const ERRORS: Record<Lang, Record<'limit' | 'overloaded' | 'auth' | 'network' | 'spawn', string>> = {
  ko: {
    limit: '사용량 한도에 도달했습니다. 한도가 초기화된 후 다시 시도해 주세요.',
    overloaded: 'AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.',
    auth: 'Claude 로그인이 필요합니다. 터미널에서 `claude login`을 실행해 주세요.',
    network: '네트워크 연결을 확인해 주세요.',
    spawn: 'Claude CLI 실행에 실패했습니다'
  },
  en: {
    limit: 'Usage limit reached. Try again after your limit resets.',
    overloaded: 'The AI service is overloaded. Please try again shortly.',
    auth: 'Claude login required. Run `claude login` in a terminal.',
    network: 'Please check your network connection.',
    spawn: 'Failed to launch the Claude CLI'
  }
}

/** Maps raw CLI failures to messages a learner can act on. */
export function friendlyError(detail: string, lang: Lang = 'ko'): string {
  const e = ERRORS[lang]
  if (/usage limit|rate limit|quota|overage|out of.*credit|insufficient/i.test(detail))
    return e.limit
  if (/overloaded|529|503/i.test(detail)) return e.overloaded
  if (/login|auth|credential|api key/i.test(detail)) return e.auth
  if (/network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(detail)) return e.network
  return detail.slice(0, 300)
}

/**
 * AIProvider implementation backed by the Claude Code CLI (`claude`).
 * No Anthropic API is used; the CLI is spawned as a child process and its
 * stream-json stdout is parsed for incremental output.
 */
export class ClaudeProvider implements AIProvider {
  readonly name = 'claude'

  constructor(
    private getLang: () => Lang = () => 'ko',
    private getModel: () => string | undefined = () => undefined
  ) {}

  /** GUI apps on macOS don't inherit the shell PATH, so augment it. */
  private env(): NodeJS.ProcessEnv {
    const extra = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(homedir(), '.local', 'bin'),
      path.join(homedir(), '.npm-global', 'bin'),
      path.join(homedir(), '.claude', 'local')
    ]
    return { ...process.env, PATH: `${process.env.PATH ?? ''}:${extra.join(':')}` }
  }

  /**
   * Working directory for the spawned CLI. Launched from Finder the app's cwd
   * is "/", and the CLI treats its cwd as the workspace and scans it — which
   * walks into ~/Desktop, ~/Downloads and ~/Music, making macOS prompt for each
   * protected folder (and Apple Music / media library). Point it at an empty,
   * non-protected folder under userData so there is nothing there to scan.
   */
  private cwd(): string {
    const dir = path.join(app.getPath('userData'), 'claude-workspace')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // best-effort; fall through and let spawn use it anyway
    }
    return dir
  }

  async checkAvailability(): Promise<{ available: boolean; version: string | null }> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { env: this.env(), cwd: this.cwd(), shell: false })
      let out = ''
      child.stdout.on('data', (d) => (out += String(d)))
      child.on('error', () => resolve({ available: false, version: null }))
      child.on('close', (code) => {
        if (code === 0) resolve({ available: true, version: out.trim() })
        else resolve({ available: false, version: null })
      })
    })
  }

  async complete(prompt: string, options: AIRequestOptions = {}): Promise<string> {
    const { onChunk, signal } = options
    return new Promise((resolve, reject) => {
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--tools',
        '',
        '--setting-sources',
        ''
      ]
      const model = this.getModel()
      if (model && model !== 'default') args.push('--model', model)
      const child = spawn('claude', args, { env: this.env(), cwd: this.cwd(), shell: false })

      let full = ''
      let sawPartial = false
      let stderr = ''
      let lineBuf = ''
      let settled = false

      const finish = (err?: Error, result?: string): void => {
        if (settled) return
        settled = true
        if (err) reject(err)
        else resolve(result ?? full)
      }

      if (signal) {
        const onAbort = (): void => {
          child.kill('SIGTERM')
          finish(new Error('aborted'))
        }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      const handleLine = (line: string): void => {
        if (!line.trim()) return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          return
        }
        if (msg.type === 'stream_event') {
          const event = msg.event as {
            type?: string
            delta?: { type?: string; text?: string }
          } | null
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            sawPartial = true
            const text = event.delta.text ?? ''
            full += text
            onChunk?.(text)
          }
        } else if (msg.type === 'assistant' && !sawPartial) {
          const message = msg.message as { content?: { type: string; text?: string }[] } | null
          for (const block of message?.content ?? []) {
            if (block.type === 'text' && block.text) {
              full += block.text
              onChunk?.(block.text)
            }
          }
        } else if (msg.type === 'result') {
          if (msg.is_error) {
            const detail = typeof msg.result === 'string' ? msg.result : '알 수 없는 오류'
            finish(new Error(friendlyError(detail, this.getLang())))
            return
          }
          const result = typeof msg.result === 'string' ? msg.result : full
          finish(undefined, full || result)
        }
      }

      child.stdout.on('data', (data) => {
        lineBuf += String(data)
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        lines.forEach(handleLine)
      })
      child.stderr.on('data', (d) => (stderr += String(d)))
      child.on('error', (err) =>
        finish(new Error(`${ERRORS[this.getLang()].spawn}: ${err.message}`))
      )
      child.on('close', (code) => {
        if (lineBuf) handleLine(lineBuf)
        if (code === 0 || full) finish(undefined, full)
        else finish(new Error(friendlyError(stderr || `Claude CLI error (exit ${code})`, this.getLang())))
      })

      child.stdin.write(prompt)
      child.stdin.end()
    })
  }
}
