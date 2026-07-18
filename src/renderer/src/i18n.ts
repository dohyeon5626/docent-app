import type { AppLanguage } from '@shared/types'
import { useAppStore } from './store/appStore'

const ko = {
  // analysis phases
  'phase.reading': 'PDF 읽는 중',
  'phase.extracting': '텍스트 추출',
  'phase.parsing': '페이지 정리',
  'phase.chapters': '챕터 분석',
  'phase.concepts': '핵심 개념 추출',
  'phase.plan': '학습 계획 생성',
  'create.title': '새 프로젝트',
  'create.name': '프로젝트 이름',
  'create.namePlaceholder': '예: 운영체제 완전 정복',
  'create.file': '문서 파일 (PDF · Word · Pages)',
  'create.analyzing': '분석하고 있습니다…',
  'create.done': '분석 완료',
  'create.failed': '분석 실패',
  'create.unknownError': '알 수 없는 오류가 발생했습니다',

  // project list
  'list.analyzing': '분석 중',
  'list.failed': '분석 실패',
  'list.empty': '아직 프로젝트가 없습니다.',
  'list.noResults': '검색 결과가 없습니다.',
  'list.deleteTitle': '프로젝트 삭제',
  'list.deleteBody': '"{name}"와 학습 기록이 모두 삭제됩니다.',
  'date.beforeStudy': '학습 전',
  'date.today': '오늘',
  'date.yesterday': '어제',
  'date.daysAgo': '{n}일 전',

  // settings
  'settings.appearance': '화면',
  'settings.theme': '테마',
  'settings.language': '언어',
  'settings.summary': '요약',
  'settings.summaryLevel': '요약 상세도',
  'settings.summaryHint':
    '새로 생성되는 요약부터 적용됩니다. 기존 프로젝트는 학습 화면의 ⋯ > Rebuild Summary로 다시 만들 수 있습니다.',
  'settings.level.brief': '간단히',
  'settings.level.standard': '보통',
  'settings.level.detailed': '자세히',
  'settings.ai': 'AI',
  'settings.aiInstalled': '설치됨',
  'settings.aiMissing': '미설치',
  'settings.aiHint': 'AI 기능은 로컬 Claude Code CLI로 동작합니다.',
  'settings.about': '정보',

  // study panel
  'study.toc': '학습 목차',
  'study.generating': '요약 문서를 작성하고 있습니다…',
  'study.writing': '작성 중…',
  'study.askAbout': '"{title}"에 대해 질문하기',
  'study.askPlaceholder': '궁금한 점을 물어보세요',
  'study.readRange': '읽은 범위 {n}%',
  'study.error': '오류가 발생했습니다',
  'study.stop': '중지',
  'study.send': '질문하기',
  'study.findPlaceholder': '요약본에서 찾기',

  // pdf
  'pdf.openFailed': 'PDF를 열 수 없습니다',

  // pane hint (separate mode)
  'pane.waiting': '프로젝트를 여는 중이거나, 아직 열린 프로젝트가 없습니다.',
  'pane.waitingHint': '파일 > 최근 프로젝트에서 선택할 수 있습니다.',

  // setup
  'setup.title': 'Claude Code CLI 설정이 필요합니다',
  'setup.body': '이 앱은 Claude Code CLI로 동작합니다. 아래 명령으로 설치하고 로그인해 주세요.',
  'setup.locked': '설치가 완료될 때까지 메인 기능은 사용할 수 없습니다.',
  'setup.stillMissing': '아직 Claude CLI를 찾을 수 없습니다. 설치 후 다시 확인해 주세요.',

  'common.loading': '불러오는 중…',
  'common.cancel': '취소',
  'common.delete': '삭제',
  'common.close': '닫기',
  'common.check': '확인',
  'common.retry': '다시 시도',
  'btn.newProject': '새 프로젝트',
  'btn.openDoc': '문서 열기…',
  'btn.selectDoc': '문서 선택…',
  'btn.create': '생성 및 분석',
  'btn.start': '학습 시작',
  'btn.back': '목록으로',
  'btn.analyzing': '분석 중…',
  'btn.checkAgain': '다시 확인',
  'btn.checking': '확인 중…',
  'menu.find': '요약본에서 찾기',
  'menu.separate': '별도 창으로 분리',
  'menu.mergeWin': '창 합치기',
  'menu.rebuild': '요약 다시 만들기',
  'menu.allProjects': '프로젝트 목록',
  'menu.fitH': '높이에 맞추기',
  'menu.fitW': '폭에 맞추기',
  'menu.actual': '실제 크기',
  'menu.level': '요약 상세도',
  'qa.merge': '요약본에 반영',
  'qa.merging': '반영 중…',
  'nav.projects': '프로젝트',
  'nav.settings': '설정',
  'settings.aiProvider': 'AI 모델',
  'settings.aiProviderHint': '지금은 Claude만 지원하며, 다른 모델은 준비 중입니다.',
  'settings.summaryDefaultHint': '새 프로젝트의 기본값입니다. 프로젝트별로 생성 시 선택하거나 학습 화면 ⋯ 메뉴에서 바꿀 수 있습니다.',
  'create.language': '요약 언어',
  'menu.lang': '요약 언어',
  'study.genFailed': '요약 생성이 중단되었습니다',
  'settings.claudeModel': 'Claude 모델',
  'settings.modelDefault': '기본값',
  'settings.modelHint': '기본값은 CLI의 설정을 따릅니다. Opus는 품질이 높지만 느리고 사용량을 더 씁니다.',
  'list.retry': '재시도'
}

const en: Record<keyof typeof ko, string> = {
  'phase.reading': 'Reading document',
  'phase.extracting': 'Extracting text',
  'phase.parsing': 'Parsing pages',
  'phase.chapters': 'Detecting chapters',
  'phase.concepts': 'Extracting concepts',
  'phase.plan': 'Creating learning plan',
  'create.title': 'New Project',
  'create.name': 'Project name',
  'create.namePlaceholder': 'e.g. Operating Systems',
  'create.file': 'Document (PDF · Word · Pages)',
  'create.analyzing': 'Analyzing…',
  'create.done': 'Analysis complete',
  'create.failed': 'Analysis failed',
  'create.unknownError': 'An unknown error occurred',

  'list.analyzing': 'Analyzing',
  'list.failed': 'Failed',
  'list.empty': 'No projects yet.',
  'list.noResults': 'No results.',
  'list.deleteTitle': 'Delete Project',
  'list.deleteBody': '"{name}" and its study history will be deleted.',
  'date.beforeStudy': 'Not started',
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',
  'date.daysAgo': '{n} days ago',

  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.language': 'Language',
  'settings.summary': 'Summaries',
  'settings.summaryLevel': 'Summary detail',
  'settings.summaryHint':
    'Applies to newly generated summaries. Rebuild existing projects via ⋯ > Rebuild Summary.',
  'settings.level.brief': 'Brief',
  'settings.level.standard': 'Standard',
  'settings.level.detailed': 'Detailed',
  'settings.ai': 'AI',
  'settings.aiInstalled': 'Installed',
  'settings.aiMissing': 'Not installed',
  'settings.aiHint': 'AI features run on the local Claude Code CLI.',
  'settings.about': 'About',

  'study.toc': 'Contents',
  'study.generating': 'Writing the summary document…',
  'study.writing': 'Writing…',
  'study.askAbout': 'Ask about "{title}"',
  'study.askPlaceholder': 'Ask anything',
  'study.readRange': 'Read {n}%',
  'study.error': 'Something went wrong',
  'study.stop': 'Stop',
  'study.send': 'Send',
  'study.findPlaceholder': 'Find in summary',

  'pdf.openFailed': 'Could not open the PDF',

  'pane.waiting': 'Opening a project, or none is open yet.',
  'pane.waitingHint': 'Pick one from File > Recent Projects.',

  'setup.title': 'Claude Code CLI required',
  'setup.body': 'This app runs on the Claude Code CLI. Install and log in with the commands below.',
  'setup.locked': 'Main features are unavailable until setup completes.',
  'setup.stillMissing': 'Claude CLI still not found. Install it and check again.',

  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.check': 'Check',
  'common.retry': 'Retry',
  'btn.newProject': 'New Project',
  'btn.openDoc': 'Open Document…',
  'btn.selectDoc': 'Select Document…',
  'btn.create': 'Create & Analyze',
  'btn.start': 'Start Learning',
  'btn.back': 'Back to Projects',
  'btn.analyzing': 'Analyzing…',
  'btn.checkAgain': 'Check Again',
  'btn.checking': 'Checking…',
  'menu.find': 'Find in Summary',
  'menu.separate': 'Open in Separate Window',
  'menu.mergeWin': 'Merge Windows',
  'menu.rebuild': 'Rebuild Summary',
  'menu.allProjects': 'All Projects',
  'menu.fitH': 'Fit to Height',
  'menu.fitW': 'Fit to Width',
  'menu.actual': 'Actual Size',
  'menu.level': 'Summary Detail',
  'qa.merge': 'Merge into Summary',
  'qa.merging': 'Merging…',
  'nav.projects': 'Projects',
  'nav.settings': 'Settings',
  'settings.aiProvider': 'AI Model',
  'settings.aiProviderHint': 'Only Claude is supported today; more models are on the way.',
  'settings.summaryDefaultHint': 'Default for new projects. Pick per project at creation, or change it later from the ⋯ menu in the study view.',
  'create.language': 'Summary language',
  'menu.lang': 'Summary Language',
  'study.genFailed': 'Summary generation was interrupted',
  'settings.claudeModel': 'Claude model',
  'settings.modelDefault': 'Default',
  'settings.modelHint': "Default follows the CLI's own setting. Opus is higher quality but slower and uses more quota.",
  'list.retry': 'Retry'
}

const dicts: Record<AppLanguage, typeof ko> = { ko, en }

export type TKey = keyof typeof ko

export function translate(lang: AppLanguage, key: TKey, vars?: Record<string, string | number>): string {
  let text: string = dicts[lang][key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v))
  return text
}

/** Reactive translator bound to the language setting. */
export function useT(): (key: TKey, vars?: Record<string, string | number>) => string {
  const lang = useAppStore((s) => s.settings?.language ?? 'ko')
  return (key, vars) => translate(lang, key, vars)
}
