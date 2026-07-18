import { useEffect, useState } from 'react'
import type { AppLanguage, AppSettings, ProjectSummary, SummaryLevel, ThemePreference } from '@shared/types'
import { useT } from '../../i18n'
import { useAppStore } from '../../store/appStore'
import { IconTrash } from '../icons'
import AppLogo from '../AppLogo'

const APP_VERSION = '0.1.0'

function relativeDate(iso: string | null, t: ReturnType<typeof useT>): string {
  if (!iso) return t('date.beforeStudy')
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return t('date.today')
  if (days === 1) return t('date.yesterday')
  if (days < 7) return t('date.daysAgo', { n: days })
  const d = new Date(iso)
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

function ProjectRow({ project }: { project: ProjectSummary }): JSX.Element {
  const openProject = useAppStore((s) => s.openProject)
  const deleteProject = useAppStore((s) => s.deleteProject)
  const retryAnalysis = useAppStore((s) => s.retryAnalysis)
  const [confirming, setConfirming] = useState(false)
  const t = useT()

  const ready = project.analysisStatus === 'done'
  const shortPath = project.pdfPath.replace(/^\/Users\/[^/]+/, '~')
  const percent = Math.round(project.progress * 100)

  return (
    <div
      className={`ij-row ${ready ? '' : 'disabled'}`}
      onClick={() => {
        if (ready) void openProject(project.id)
      }}
    >
      <div className="info">
        <div className="name-line">
          <span className="name">{project.name}</span>
          {project.analysisStatus === 'analyzing' && <span className="badge analyzing"><span className="spinner small" />{t('list.analyzing')}</span>}
          {project.analysisStatus === 'error' && <span className="badge error">{t('list.failed')}</span>}
        </div>
        <div className="path">{shortPath}</div>
      </div>
      {ready && (
        <div className="row-progress">
          <div className="progress-bar">
            <div style={{ width: `${percent}%` }} />
          </div>
          <span>{percent}%</span>
        </div>
      )}
      {project.analysisStatus === 'error' && (
        <button
          className="pill-btn"
          onClick={(e) => {
            e.stopPropagation()
            void retryAnalysis(project.id)
          }}
        >
          {t('list.retry')}
        </button>
      )}
      <span className="date">{relativeDate(project.lastOpenedAt, t)}</span>
      <button
        className="icon-btn row-delete"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          setConfirming(true)
        }}
      >
        <IconTrash />
      </button>

      {confirming && (
        <div className="modal-backdrop" onClick={(e) => e.stopPropagation()}>
          <div className="modal">
            <h3>{t('list.deleteTitle')}</h3>
            <p className="hint">{t('list.deleteBody', { name: project.name })}</p>
            <div className="actions">
              <button onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
              <button className="danger" onClick={() => void deleteProject(project.id)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsView(): JSX.Element {
  const cli = useAppStore((s) => s.cli)
  const recheckCli = useAppStore((s) => s.recheckCli)
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [level, setLevel] = useState<SummaryLevel>('standard')
  const [language, setLanguage] = useState<AppLanguage>('ko')
  const [aiModel, setAiModel] = useState<NonNullable<AppSettings['aiModel']>>('default')
  const t = useT()

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setTheme(s.theme ?? 'system')
      setLevel(s.summaryLevel ?? 'standard')
      setLanguage(s.language ?? 'ko')
      setAiModel(s.aiModel ?? 'default')
    })
  }, [])

  const applyTheme = (t: ThemePreference): void => {
    setTheme(t)
    void window.api.setTheme(t)
  }

  const applyLevel = (l: SummaryLevel): void => {
    setLevel(l)
    void window.api.setSummaryLevel(l)
  }

  const applyLanguage = (l: AppLanguage): void => {
    setLanguage(l)
    void window.api.setLanguage(l)
  }

  const applyAiModel = (m: NonNullable<AppSettings['aiModel']>): void => {
    setAiModel(m)
    void window.api.setAiModel(m)
  }

  return (
    <div className="settings-view">
      <section>
        <h3>{t('settings.appearance')}</h3>
        <div className="setting-row">
          <span>{t('settings.theme')}</span>
          <div className="seg-control">
            {(
              [
                ['system', 'System'],
                ['light', 'Light'],
                ['dark', 'Dark']
              ] as [ThemePreference, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={theme === value ? 'active' : ''}
                onClick={() => applyTheme(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span>{t('settings.language')}</span>
          <div className="seg-control">
            {(
              [
                ['ko', '한국어'],
                ['en', 'English']
              ] as [AppLanguage, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={language === value ? 'active' : ''}
                onClick={() => applyLanguage(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3>{t('settings.summary')}</h3>
        <div className="setting-row">
          <span>{t('settings.summaryLevel')}</span>
          <div className="seg-control">
            {(
              [
                ['brief', t('settings.level.brief')],
                ['standard', t('settings.level.standard')],
                ['detailed', t('settings.level.detailed')]
              ] as [SummaryLevel, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={level === value ? 'active' : ''}
                onClick={() => applyLevel(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="hint">{t('settings.summaryDefaultHint')}</span>
        </div>
      </section>

      <section>
        <h3>{t('settings.ai')}</h3>
        <div className="setting-row">
          <span>{t('settings.aiProvider')}</span>
          <div className="seg-control">
            <button className="active">Claude</button>
            <button disabled title={t('settings.aiProviderHint')}>
              GPT
            </button>
            <button disabled title={t('settings.aiProviderHint')}>
              Gemini
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span>{t('settings.claudeModel')}</span>
          <div className="seg-control">
            {(
              [
                ['default', t('settings.modelDefault')],
                ['sonnet', 'Sonnet'],
                ['opus', 'Opus'],
                ['fable', 'Fable']
              ] as [NonNullable<AppSettings['aiModel']>, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={aiModel === value ? 'active' : ''}
                onClick={() => applyAiModel(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="hint">{t('settings.modelHint')}</span>
        </div>
        <div className="setting-row">
          <span>Claude Code CLI</span>
          <span className="value">
            <span className={`status-dot ${cli?.installed ? 'ok' : 'bad'}`} />
            {cli?.installed ? (cli.version ?? t('settings.aiInstalled')) : t('settings.aiMissing')}
          </span>
        </div>
        <div className="setting-row">
          <span className="hint">{t('settings.aiHint')}</span>
          <button onClick={() => void recheckCli()}>{t('common.check')}</button>
        </div>
      </section>

      <section>
        <h3>{t('settings.about')}</h3>
        <div className="setting-row">
          <span>Docent</span>
          <span className="value">Version {APP_VERSION}</span>
        </div>
      </section>
    </div>
  )
}

export default function ProjectListScreen(): JSX.Element {
  const projects = useAppStore((s) => s.projects)
  const goToCreate = useAppStore((s) => s.goToCreate)
  const t = useT()
  const [view, setView] = useState<'projects' | 'settings'>('projects')

  const sorted = projects
    .slice()
    .sort((a, b) => (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt))

  return (
    <div className="ij-welcome">
      <aside className="ij-side">
        <div className="traffic-space" />
        <div className="ij-app">
          <AppLogo size={32} />
          <div>
            <div className="ij-app-name">docent</div>
            <div className="ij-app-ver">{APP_VERSION}</div>
          </div>
        </div>
        <nav className="ij-nav">
          <div
            className={`ij-nav-item ${view === 'projects' ? 'selected' : ''}`}
            onClick={() => setView('projects')}
          >
            {t('nav.projects')}
          </div>
          <div
            className={`ij-nav-item ${view === 'settings' ? 'selected' : ''}`}
            onClick={() => setView('settings')}
          >
            {t('nav.settings')}
          </div>
        </nav>
      </aside>

      <main className="ij-main">
        {view === 'projects' ? (
          <>
            <div className="ij-topbar">
              <span className="ij-title">{t('nav.projects')}</span>
              <span style={{ flex: 1 }} className="drag-region" />
              <button onClick={goToCreate}>{t('btn.newProject')}</button>
            </div>
            <div className="ij-list">
              {sorted.length === 0 ? (
                <div className="center-screen">
                  <p className="hint">{t('list.empty')}</p>
                  <button className="primary" onClick={goToCreate}>
                    {t('btn.openDoc')}
                  </button>
                </div>
              ) : (
                sorted.map((p) => <ProjectRow key={p.id} project={p} />)
              )}
            </div>
          </>
        ) : (
          <>
            <div className="ij-topbar">
              <span className="ij-title">{t('nav.settings')}</span>
              <span style={{ flex: 1 }} className="drag-region" />
            </div>
            <SettingsView />
          </>
        )}
      </main>
    </div>
  )
}
