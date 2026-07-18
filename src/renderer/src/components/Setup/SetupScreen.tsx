import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useT } from '../../i18n'

export default function SetupScreen(): JSX.Element {
  const recheckCli = useAppStore((s) => s.recheckCli)
  const t = useT()
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)

  const recheck = async (): Promise<void> => {
    setChecking(true)
    setFailed(false)
    await recheckCli()
    // still on this screen means the CLI was not found
    setFailed(true)
    setChecking(false)
  }

  return (
    <div className="center-screen">
      <div className="form-card">
        <h2>{t('setup.title')}</h2>
        <p className="hint">{t('setup.body')}</p>
        <code className="block">npm install -g @anthropic-ai/claude-code</code>
        <code className="block">claude login</code>
        <p className="hint">{t('setup.locked')}</p>
        {failed && !checking && (
          <div className="error-banner" style={{ margin: 0 }}>
            {t('setup.stillMissing')}
          </div>
        )}
        <button className="primary" onClick={() => void recheck()} disabled={checking}>
          {checking ? t('btn.checking') : t('btn.checkAgain')}
        </button>
      </div>
    </div>
  )
}
