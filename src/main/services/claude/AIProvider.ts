export interface AIRequestOptions {
  /** Called with incremental text as the model streams. */
  onChunk?: (text: string) => void
  /** Abort signal to cancel the request. */
  signal?: AbortSignal
}

/**
 * Abstraction over AI backends. The app only ever talks to this interface;
 * ClaudeProvider (Claude Code CLI) is the current implementation, and
 * OpenAI/Gemini/Ollama providers can be added without touching callers.
 */
export interface AIProvider {
  readonly name: string
  /** Checks whether the backend is usable; returns a version string if so. */
  checkAvailability(): Promise<{ available: boolean; version: string | null }>
  /** Sends a prompt and resolves with the full response text. */
  complete(prompt: string, options?: AIRequestOptions): Promise<string>
}
