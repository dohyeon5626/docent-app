import type { AIProvider } from './AIProvider'
import { ClaudeProvider } from './ClaudeProvider'

export interface ProviderInfo {
  id: string
  label: string
  /** false = listed in settings but not selectable yet */
  available: boolean
}

/**
 * Registry of AI backends. To add a new model (OpenAI, Gemini, Ollama...):
 *  1. implement AIProvider in a sibling file,
 *  2. register it here,
 *  3. it becomes selectable in Settings — nothing else in the app changes.
 */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code CLI', available: true },
  { id: 'openai', label: 'OpenAI (coming soon)', available: false },
  { id: 'gemini', label: 'Gemini (coming soon)', available: false },
  { id: 'ollama', label: 'Ollama (coming soon)', available: false }
]

export function createAIProvider(
  id: string | undefined,
  getLang: () => 'ko' | 'en' = () => 'ko',
  getModel: () => string | undefined = () => undefined
): AIProvider {
  switch (id) {
    case 'claude':
    default:
      return new ClaudeProvider(getLang, getModel)
  }
}
