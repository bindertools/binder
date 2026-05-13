export type TabType = 'terminal' | 'editor' | 'database' | 'preview' | 'problems' | 'config' | 'ports' | 'perf' | 'plugins' | 'notepad' | 'git' | 'claude' | (string & {})

export interface ProbItem {
  file: string
  line: number
  col: number
  sev: number   // 0 = error · 1 = warn · 2 = info
  code: string
  msg: string
}

export interface Tab {
  id: string
  type: TabType
  title: string
  parentId?: string   // for editor/database/preview/problems tabs
  // editor-only
  filePath?: string
  content?: string
  language?: string
  gotoLine?: number   // navigate to this line when the editor mounts / value changes
  // terminal-only
  initialCwd?: string
  // database-only
  dbPath?: string
  // preview-only
  previewType?: 'markdown' | 'html' | 'url'
  previewSrc?: string
  previewPath?: string
  // problems-only
  problemsCwd?: string
  problemsSources?: string[]
  problemsItems?: ProbItem[]
  // extra context for plugin tabs (cwd, etc.)
  meta?: Record<string, string>
}

export interface OpenDatabasePayload {
  path: string
  terminalId?: string
}

export interface OpenPreviewPayload {
  type: 'markdown' | 'html' | 'url'
  path?: string
  content?: string
  url?: string
  terminalId?: string
}

export interface OpenFilePayload {
  path: string
  content: string
  language: string
  terminalId?: string
  gotoLine?: number
}

export interface OpenProblemsPayload {
  cwd: string
  sources: string[]
  items: ProbItem[]
  terminalId?: string
}

export interface OpenTabPayload {
  type: TabType
  title: string
  terminalId?: string
  cwd?: string
}

export interface PortInfo {
  protocol: string
  port: number
  pid: number
  process: string
  address: string
  state: string
}

export interface PerfData {
  cpu_percent: number
  mem_used: number
  mem_total: number
  mem_percent: number
  disk_used: number
  disk_total: number
  disk_percent: number
  net_bytes_sent: number
  net_bytes_recv: number
  gpu_percent: number
  gpu_name: string
  gpu_available: boolean
}

export interface SearchResult {
  path: string
  line: number
  content: string
  is_name: boolean
}

export interface GitRecognitionConfig {
  show_git_branch: boolean
}

export interface AppConfig {
  default_directory: string
  indent_guides: boolean
  order_directory: boolean
  minimap: boolean
  theme: string
  show_timestamps: boolean
  git_recognition: GitRecognitionConfig
  soft_close: boolean
  zoom_insights: boolean
  minimal_pwd: boolean
  default_zoom: number
  custom_theme?: Record<string, string>
  terminal_word_wrap: boolean
  file_word_wrap: boolean
  scroll_speed: number
}
