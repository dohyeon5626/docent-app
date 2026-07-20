import { useEffect, useState } from 'react'
import type { AnalysisPhase, AppLanguage, SummaryLevel } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import { useT, type TKey } from '../../i18n'
import { IconDoc } from '../icons'

const PHASES: { key: AnalysisPhase; label: TKey }[] = [
  { key: 'reading-pdf', label: 'phase.reading' },
  { key: 'extracting-text', label: 'phase.extracting' },
  { key: 'parsing-pages', label: 'phase.parsing' },
  { key: 'detecting-chapters', label: 'phase.chapters' },
  { key: 'extracting-concepts', label: 'phase.concepts' },
  { key: 'creating-learning-plan', label: 'phase.plan' }
]

export default function CreateProjectScreen(): JSX.Element {
  const goToProjects = useAppStore((s) => s.goToProjects)
  const createProject = useAppStore((s) => s.createProject)
  const openProject = useAppStore((s) => s.openProject)
  const progress = useAppStore((s) => s.createProgress)
  const t = useT()

  const [name, setName] = useState('')
  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [level, setLevel] = useState<SummaryLevel>('standard')
  const [docLang, setDocLang] = useState<AppLanguage>('ko')

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setLevel(s.summaryLevel ?? 'standard')
      setDocLang(s.language ?? 'ko')
    })
  }, [])

  const pick = async (): Promise<void> => {
    const path = await window.api.pickPdf()
    if (path) {
      setPdfPath(path)
      if (!name) setName(path.split('/').pop()?.replace(/\.pdf$/i, '') ?? '')
    }
  }

  const analyzing = progress !== null && progress.phase !== 'done' && progress.phase !== 'error'
  const done = progress?.phase === 'done'
  const failed = progress?.phase === 'error'
  const phaseIdx = progress ? PHASES.findIndex((p) => p.key === progress.phase) : -1

  return (
    <div className="welcome">
      <div className="drag-strip" />
      <div className="center-screen" style={{ justifyContent: 'flex-start', paddingTop: 48 }}>
        <div className="form-card">
          {!progress && (
            <>
              <h2>{t('create.title')}</h2>
              <label>
                {t('create.name')}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('create.namePlaceholder')}
                  autoFocus
                />
              </label>
              <label>
                {t('create.file')}
                <button
                  onClick={() => void pick()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
                >
                  <IconDoc />
                  {pdfPath ? pdfPath.split('/').pop() : t('btn.selectDoc')}
                </button>
              </label>
              <label>
                {t('settings.summaryLevel')}
                <div className="seg-control" style={{ alignSelf: 'flex-start' }}>
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
                      onClick={() => setLevel(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                {t('create.language')}
                <div className="seg-control" style={{ alignSelf: 'flex-start' }}>
                  {(
                    [
                      ['ko', '한국어'],
                      ['en', 'English']
                    ] as [AppLanguage, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className={docLang === value ? 'active' : ''}
                      onClick={() => setDocLang(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={goToProjects}>{t('common.cancel')}</button>
                <button
                  className="primary"
                  disabled={!name.trim() || !pdfPath}
                  onClick={() => void createProject(name.trim(), pdfPath!, level, docLang)}
                >
                  {t('btn.create')}
                </button>
              </div>
            </>
          )}

          {progress && (
            <>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {analyzing && <span className="spinner" />}
                {done ? t('create.done') : failed ? t('create.failed') : t('create.analyzing')}
              </h2>
              <div className="progress-bar" style={{ height: 6 }}>
                <div style={{ width: `${Math.round(progress.progress * 100)}%` }} />
              </div>
              <div className="phase-list">
                {PHASES.map((p, i) => {
                  const state = done || i < phaseIdx ? 'done' : i === phaseIdx ? 'active' : ''
                  return (
                    <div key={p.key} className={`phase ${state}`}>
                      <span className="mark">
                        {state === 'done' ? (
                          '✓'
                        ) : state === 'active' ? (
                          <span className="spinner small" />
                        ) : (
                          '○'
                        )}
                      </span>
                      <span>{t(p.label)}</span>
                      {state === 'active' && progress.detail && (
                        <span className="hint">{progress.detail}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {failed && (
                <div className="error-banner" style={{ margin: 0 }}>
                  {progress.detail ?? t('create.unknownError')}
                </div>
              )}
              {done && (
                <button className="primary" onClick={() => void openProject(progress.projectId)}>
                  {t('btn.start')}
                </button>
              )}
              {(failed || analyzing) && (
                <button onClick={goToProjects} disabled={analyzing}>
                  {analyzing ? t('btn.analyzing') : t('btn.back')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
