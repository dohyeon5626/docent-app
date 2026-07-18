import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  Analysis,
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

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

// Atomic writes, serialized per file so concurrent windows can't clobber
// each other (two renderers often touch projects.json at the same moment).
const writeQueues = new Map<string, Promise<void>>()

async function writeJson(file: string, value: unknown): Promise<void> {
  const prev = writeQueues.get(file) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
      await fs.rename(tmp, file)
    })
  writeQueues.set(file, next)
  try {
    await next
  } finally {
    if (writeQueues.get(file) === next) writeQueues.delete(file)
  }
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

export async function appendConversation(id: string, entry: ConversationEntry): Promise<void> {
  const conversation = await getConversation(id)
  conversation.push(entry)
  await saveConversation(id, conversation)
}

// ---------- Settings ----------

const defaultSettings: AppSettings = {
  windowMode: 'split',
  splitRatio: 0.5,
  windows: {}
}

export const getSettings = (): Promise<AppSettings> =>
  readJson<AppSettings>(settingsFile(), defaultSettings)
export const saveSettings = (s: AppSettings): Promise<void> => writeJson(settingsFile(), s)
