import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useT } from './i18n'
import SetupScreen from './components/Setup/SetupScreen'
import ProjectListScreen from './components/ProjectList/ProjectListScreen'
import CreateProjectScreen from './components/CreateProject/CreateProjectScreen'
import MainScreen from './components/MainScreen'

export default function App(): JSX.Element {
  const t = useT()
  const screen = useAppStore((s) => s.screen)
  const paneRole = useAppStore((s) => s.paneRole)
  const init = useAppStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (screen === 'loading') {
    return (
      <div className="welcome">
        <div className="drag-strip" />
        <div className="center-screen">
          <div className="hint">{t('common.loading')}</div>
        </div>
      </div>
    )
  }

  if (screen === 'setup') {
    return (
      <div className="welcome">
        <div className="drag-strip" />
        <SetupScreen />
      </div>
    )
  }

  // separate-mode pane windows show only their own pane
  if (paneRole !== 'both') {
    return screen === 'main' ? (
      <div className="shell-single">
        <MainScreen pane={paneRole} />
      </div>
    ) : (
      <div className="welcome">
        <div className="center-screen">
          <p className="hint">{t('pane.waiting')}</p>
          <p className="hint">{t('pane.waitingHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shell-single">
      {screen === 'projects' && <ProjectListScreen />}
      {screen === 'create' && <CreateProjectScreen />}
      {screen === 'main' && <MainScreen pane="both" />}
    </div>
  )
}
