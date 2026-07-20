import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  Analysis,
  AppLanguage,
  AppSettings,
  ConversationEntry,
  LearningPlan,
  LearningSession,
  PageText,
  Project
} from '@shared/types'

const dataRoot = (): string => path.join(app.getPath('userData'), 'data')
const projectsFile = (): string => path.join(dataRoot(), 'projects.json')
const settingsFile = (): string => path.join(dataRoot(), 'settings.json')
export const projectDir = (id: string): string => path.join(dataRoot(), 'projects', id)

/**
 * Copy an imported document into the project's own folder and return the new
 * path. The original lives in the user's Desktop/Documents/Downloads, which are
 * TCC-protected: reading from there re-triggers a macOS permission prompt on
 * every relaunch. userData is unprotected, so once copied we never prompt again
 * (and the project keeps working even if the user moves or deletes the source).
 */
export async function importSource(id: string, srcPath: string): Promise<string> {
  const dir = projectDir(id)
  await fs.mkdir(dir, { recursive: true })
  const ext = path.extname(srcPath) || '.pdf'
  const dest = path.join(dir, `source${ext}`)
  await fs.copyFile(srcPath, dest)
  return dest
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
  await fs.rename(tmp, file)
}

// Serializes operations per file so concurrent callers can't clobber each
// other — not just the final write, but read-modify-write cycles like
// appendConversation/updateConversation, which parallel summary generation
// can trigger several of at once for the same project.
const fileQueues = new Map<string, Promise<unknown>>()

function enqueue<T>(file: string, task: () => Promise<T>): Promise<T> {
  const prev = fileQueues.get(file) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(task)
  fileQueues.set(file, next)
  next.finally(() => {
    if (fileQueues.get(file) === next) fileQueues.delete(file)
  })
  return next
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await enqueue(file, () => atomicWrite(file, value))
}

// ---------- Projects ----------

export async function listProjects(): Promise<Project[]> {
  return readJson<Project[]>(projectsFile(), [])
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await writeJson(projectsFile(), projects)
}

export async function upsertProject(project: Project): Promise<void> {
  const projects = await listProjects()
  const idx = projects.findIndex((p) => p.id === project.id)
  if (idx >= 0) projects[idx] = project
  else projects.push(project)
  await saveProjects(projects)
}

export async function deleteProject(id: string): Promise<void> {
  await saveProjects((await listProjects()).filter((p) => p.id !== id))
  await fs.rm(projectDir(id), { recursive: true, force: true })
}

// ---------- Per-project data ----------

const projectFile = (id: string, name: string): string => path.join(projectDir(id), name)

export const getAnalysis = (id: string): Promise<Analysis | null> =>
  readJson<Analysis | null>(projectFile(id, 'analysis.json'), null)
export const saveAnalysis = (id: string, a: Analysis): Promise<void> =>
  writeJson(projectFile(id, 'analysis.json'), a)

export const getPageTexts = (id: string): Promise<PageText[]> =>
  readJson<PageText[]>(projectFile(id, 'pages.json'), [])
export const savePageTexts = (id: string, p: PageText[]): Promise<void> =>
  writeJson(projectFile(id, 'pages.json'), p)

export const getPlan = (id: string): Promise<LearningPlan | null> =>
  readJson<LearningPlan | null>(projectFile(id, 'plan.json'), null)
export const savePlan = (id: string, p: LearningPlan): Promise<void> =>
  writeJson(projectFile(id, 'plan.json'), p)

export const getSession = (id: string): Promise<LearningSession | null> =>
  readJson<LearningSession | null>(projectFile(id, 'session.json'), null)
export const saveSession = (id: string, s: LearningSession): Promise<void> =>
  writeJson(projectFile(id, 'session.json'), s)

export const getConversation = (id: string): Promise<ConversationEntry[]> =>
  readJson<ConversationEntry[]>(projectFile(id, 'conversation.json'), [])
export const saveConversation = (id: string, c: ConversationEntry[]): Promise<void> =>
  writeJson(projectFile(id, 'conversation.json'), c)

/**
 * Runs `mutate` against the current conversation and persists the result,
 * all within one queued slot per project so two concurrent callers (e.g.
 * parallel step-summary generations) can't read the same stale snapshot and
 * clobber each other's writes.
 */
export function updateConversation(
  id: string,
  mutate: (conversation: ConversationEntry[]) => ConversationEntry[]
): Promise<ConversationEntry[]> {
  const file = projectFile(id, 'conversation.json')
  return enqueue(file, async () => {
    const conversation = await readJson<ConversationEntry[]>(file, [])
    const updated = mutate(conversation)
    await atomicWrite(file, updated)
    return updated
  })
}

export async function appendConversation(id: string, entry: ConversationEntry): Promise<void> {
  await updateConversation(id, (conversation) => [...conversation, entry])
}

// ---------- Settings ----------

/** First-install default: match the OS language, falling back to English. */
const detectDefaultLanguage = (): AppLanguage =>
  app.getLocale().toLowerCase().startsWith('ko') ? 'ko' : 'en'

const defaultSettings = (): AppSettings => ({
  windowMode: 'split',
  splitRatio: 0.5,
  windows: {},
  language: detectDefaultLanguage()
})

export const getSettings = (): Promise<AppSettings> =>
  readJson<AppSettings>(settingsFile(), defaultSettings())
export const saveSettings = (s: AppSettings): Promise<void> => writeJson(settingsFile(), s)
