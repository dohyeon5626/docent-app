import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { AppLanguage, Project } from '@shared/types'
import type { WindowManager } from './WindowManager'

const L: Record<AppLanguage, Record<string, string>> = {
  ko: {
    file: '파일',
    newProject: '새 프로젝트…',
    projectList: '프로젝트 목록',
    recent: '최근 프로젝트',
    none: '없음',
    newWindow: '새 창',
    close: '창 닫기',
    edit: '편집',
    view: '보기',
    separate: 'PDF와 학습을 별도 창으로',
    fullscreen: '전체 화면',
    window: '윈도우'
  },
  en: {
    file: 'File',
    newProject: 'New Project…',
    projectList: 'All Projects',
    recent: 'Recent Projects',
    none: 'None',
    newWindow: 'New Window',
    close: 'Close Window',
    edit: 'Edit',
    view: 'View',
    separate: 'Split PDF & Study into Windows',
    fullscreen: 'Full Screen',
    window: 'Window'
  }
}

/**
 * Native application menu. Project switching lives here (recent projects),
 * plus VSCode-style New Window and the PDF/Study window split toggle.
 */
export function buildAppMenu(wm: WindowManager, recents: Project[]): void {
  const lang: AppLanguage = wm.getSettings().language ?? 'ko'
  const s = L[lang]

  const openHome = (type: 'home' | 'create'): void => {
    // list/create screens live in the combined window; merge first if split apart
    void wm.setWindowMode('split', { type })
  }

  const recentItems: MenuItemConstructorOptions[] =
    recents.length === 0
      ? [{ label: s.none, enabled: false }]
      : recents
          .slice()
          .sort((a, b) =>
            (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt)
          )
          .slice(0, 10)
          .map((p) => ({
            label: p.name,
            enabled: p.analysisStatus === 'done',
            click: (): void => wm.sendToFocused({ type: 'open-project', projectId: p.id })
          }))

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: s.file,
      submenu: [
        { label: s.newProject, accelerator: 'CmdOrCtrl+N', click: (): void => openHome('create') },
        { label: s.projectList, accelerator: 'CmdOrCtrl+O', click: (): void => openHome('home') },
        { type: 'separator' },
        { label: s.recent, submenu: recentItems },
        { type: 'separator' },
        {
          label: s.newWindow,
          accelerator: 'CmdOrCtrl+Shift+N',
          enabled: wm.getSettings().windowMode === 'split',
          click: (): void => wm.newMainWindow()
        },
        { type: 'separator' },
        { role: 'close', label: s.close }
      ]
    },
    { role: 'editMenu', label: s.edit },
    {
      label: s.view,
      submenu: [
        {
          label: s.separate,
          type: 'checkbox',
          checked: wm.getSettings().windowMode === 'separate',
          click: (item): void => {
            const recent = recents
              .filter((p) => p.analysisStatus === 'done' && p.lastOpenedAt)
              .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0]
            void wm.setWindowMode(
              item.checked ? 'separate' : 'split',
              recent ? { type: 'open-project', projectId: recent.id } : undefined
            )
            buildAppMenu(wm, recents)
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: s.fullscreen },
        ...(app.isPackaged
          ? []
          : [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { role: 'toggleDevTools' as const }
            ])
      ]
    },
    { role: 'windowMenu', label: s.window }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
