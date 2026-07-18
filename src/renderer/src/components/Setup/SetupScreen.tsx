import { useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useT } from '../../i18n'
import { IconClaude } from '../icons'

const FLASH_DURATION = 2500

export default function SetupScreen(): JSX.Element {
  const recheckCli = useAppStore((s) => s.recheckCli)
  const t = useT()
  const [checking, setChecking] = useState(false)
  const [flashError, setFlashError] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()

  const recheck = async (): Promise<void> => {
    setChecking(true)
    await recheckCli()
    // still on this screen means the CLI was not found
    setChecking(false)
    clearTimeout(flashTimer.current)
    setFlashError(false)
    requestAnimationFrame(() => {
      setFlashError(true)
      flashTimer.current = setTimeout(() => setFlashError(false), FLASH_DURATION)
    })
  }

  return (
    <div className="center-screen">
      <div className={`form-card setup-card ${flashError ? 'flash-error' : ''}`}>
        <div className="setup-icon">
          <IconClaude size={26} />
        </div>
        <h2>{t('setup.title')}</h2>
        <p className="hint" style={{ whiteSpace: 'pre-line' }}>
          {t('setup.body')}
        </p>

        <div className="setup-manual">
          <span className="hint">{t('setup.manualLabel')}</span>
          <a
            className="page-link"
            href="https://code.claude.com/docs/en/setup"
            target="_blank"
            rel="noreferrer"
          >
            code.claude.com/docs/en/setup
          </a>
        </div>

        <button onClick={() => void recheck()} disabled={checking}>
          {checking && <span className="spinner small" />}
          {checking ? t('btn.checking') : t('btn.checkAgain')}
        </button>

        {flashError && <span className="setup-flash-message">{t('setup.stillMissing')}</span>}
      </div>
    </div>
  )
}
