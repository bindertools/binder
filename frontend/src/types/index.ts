export type TabType = 'terminal' | 'editor'

export interface Tab {
  id: string
  type: TabType
  title: string
  parentId?: string   // for editor tabs: which terminal opened them
  // editor-only
  filePath?: string
  content?: string
  language?: string
}

export interface OpenFilePayload {
  path: string
  content: string
  language: string
  terminalId?: string
}

export interface AppConfig {
  default_directory: string
  indent_guides: boolean
  order_directory: boolean
}
