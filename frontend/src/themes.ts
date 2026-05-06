import type { ITheme } from '@xterm/xterm'

export interface AppTheme {
  appBg: string
  borderColor: string
  infoBarBg: string
  infoBarColor: string
  infoBarHoverBg: string
  infoBarHoverColor: string
  monacoThemeId: string
  monacoThemeDef?: {
    base: 'vs' | 'vs-dark' | 'hc-black'
    inherit: boolean
    rules: { token: string; foreground?: string; background?: string; fontStyle?: string }[]
    colors: Record<string, string>
  }
  xtermTheme: ITheme
}

export const THEMES: Record<string, AppTheme> = {
  dark: {
    appBg: '#0d0d0d',
    borderColor: '#1e1e1e',
    infoBarBg: '#141414',
    infoBarColor: '#555555',
    infoBarHoverBg: '#1a1a1a',
    infoBarHoverColor: '#888888',
    monacoThemeId: 'vs-dark',
    xtermTheme: {
      background: '#0d0d0d',
      foreground: '#cccccc',
      cursor: '#cccccc',
      cursorAccent: '#0d0d0d',
      selectionBackground: '#264f7855',
      black: '#1a1a1a', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
      blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
      brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
      brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
      brightCyan: '#29b8db', brightWhite: '#ffffff',
    },
  },

  blackout: {
    appBg: '#111111',
    borderColor: '#2a2a2a',
    infoBarBg: '#111111',
    infoBarColor: '#666666',
    infoBarHoverBg: '#1a1a1a',
    infoBarHoverColor: '#aaaaaa',
    monacoThemeId: 'blackout',
    monacoThemeDef: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '', foreground: 'ffffff', background: '111111' },
        { token: 'comment', foreground: '666666', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
        { token: 'string', foreground: 'cccccc' },
        { token: 'number', foreground: 'aaaaaa' },
        { token: 'type', foreground: 'eeeeee' },
        { token: 'function', foreground: 'ffffff' },
        { token: 'variable', foreground: 'dddddd' },
        { token: 'operator', foreground: 'ffffff' },
      ],
      colors: {
        'editor.background': '#111111',
        'editor.foreground': '#ffffff',
        'editor.lineHighlightBackground': '#1a1a1a',
        'editor.selectionBackground': '#333333',
        'editorCursor.foreground': '#ffffff',
        'editorLineNumber.foreground': '#444444',
        'editorLineNumber.activeForeground': '#888888',
        'editor.inactiveSelectionBackground': '#222222',
        'editorGutter.background': '#111111',
        'editorWidget.background': '#1a1a1a',
        'editorSuggestWidget.background': '#1a1a1a',
        'editorSuggestWidget.border': '#333333',
        'editorSuggestWidget.selectedBackground': '#333333',
        'input.background': '#1a1a1a',
        'input.border': '#333333',
        'scrollbarSlider.background': '#333333',
        'scrollbarSlider.hoverBackground': '#444444',
        'scrollbarSlider.activeBackground': '#555555',
      },
    },
    xtermTheme: {
      background: '#111111',
      foreground: '#ffffff',
      cursor: '#ffffff',
      cursorAccent: '#111111',
      selectionBackground: '#33333355',
      black: '#111111', red: '#cc4444', green: '#aaaaaa', yellow: '#888888',
      blue: '#888888', magenta: '#aaaaaa', cyan: '#cccccc', white: '#ffffff',
      brightBlack: '#555555', brightRed: '#ff4444', brightGreen: '#ffffff',
      brightYellow: '#dddddd', brightBlue: '#bbbbbb', brightMagenta: '#dddddd',
      brightCyan: '#ffffff', brightWhite: '#ffffff',
    },
  },

  'dim-green': {
    appBg: '#0a0f0a',
    borderColor: '#182818',
    infoBarBg: '#0d140d',
    infoBarColor: '#2a4a2a',
    infoBarHoverBg: '#111a11',
    infoBarHoverColor: '#4a7a4a',
    monacoThemeId: 'dim-green',
    monacoThemeDef: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '', foreground: '4af04a', background: '0a0f0a' },
        { token: 'comment', foreground: '2a5a2a', fontStyle: 'italic' },
        { token: 'keyword', foreground: '88ff88', fontStyle: 'bold' },
        { token: 'string', foreground: '5acc5a' },
        { token: 'number', foreground: '7aff7a' },
        { token: 'type', foreground: 'aaffaa' },
        { token: 'function', foreground: '88ee88' },
        { token: 'variable', foreground: '4af04a' },
        { token: 'operator', foreground: '88ff88' },
      ],
      colors: {
        'editor.background': '#0a0f0a',
        'editor.foreground': '#4af04a',
        'editor.lineHighlightBackground': '#0d150d',
        'editor.selectionBackground': '#1a3a1a',
        'editorCursor.foreground': '#4af04a',
        'editorLineNumber.foreground': '#1e3a1e',
        'editorLineNumber.activeForeground': '#3a6a3a',
        'editor.inactiveSelectionBackground': '#141e14',
        'editorGutter.background': '#0a0f0a',
        'editorWidget.background': '#0d150d',
        'editorSuggestWidget.background': '#0d150d',
        'editorSuggestWidget.border': '#1a3a1a',
        'editorSuggestWidget.selectedBackground': '#1a3a1a',
        'input.background': '#0d150d',
        'input.border': '#1a3a1a',
        'scrollbarSlider.background': '#1a3a1a',
        'scrollbarSlider.hoverBackground': '#254525',
        'scrollbarSlider.activeBackground': '#2a5a2a',
      },
    },
    xtermTheme: {
      background: '#0a0f0a',
      foreground: '#4af04a',
      cursor: '#4af04a',
      cursorAccent: '#0a0f0a',
      selectionBackground: '#1a3a1a55',
      black: '#0a0f0a', red: '#cc3333', green: '#4af04a', yellow: '#aaee44',
      blue: '#2a7a4a', magenta: '#4a8a4a', cyan: '#2acca0', white: '#88ee88',
      brightBlack: '#2a4a2a', brightRed: '#ff4444', brightGreen: '#88ff88',
      brightYellow: '#ccff44', brightBlue: '#44aa88', brightMagenta: '#88cc88',
      brightCyan: '#44ffcc', brightWhite: '#aaffaa',
    },
  },

  'dim-blue': {
    appBg: '#0a0d14',
    borderColor: '#171e30',
    infoBarBg: '#0d1018',
    infoBarColor: '#2a3a5a',
    infoBarHoverBg: '#111520',
    infoBarHoverColor: '#4a6a9a',
    monacoThemeId: 'dim-blue',
    monacoThemeDef: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '', foreground: '6ab4fa', background: '0a0d14' },
        { token: 'comment', foreground: '2a3a5a', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'aad4ff', fontStyle: 'bold' },
        { token: 'string', foreground: '88ccff' },
        { token: 'number', foreground: '99ddff' },
        { token: 'type', foreground: 'cce8ff' },
        { token: 'function', foreground: 'aaccee' },
        { token: 'variable', foreground: '6ab4fa' },
        { token: 'operator', foreground: 'aad4ff' },
      ],
      colors: {
        'editor.background': '#0a0d14',
        'editor.foreground': '#6ab4fa',
        'editor.lineHighlightBackground': '#0d1220',
        'editor.selectionBackground': '#1a2a4a',
        'editorCursor.foreground': '#6ab4fa',
        'editorLineNumber.foreground': '#1e2a4a',
        'editorLineNumber.activeForeground': '#3a5a8a',
        'editor.inactiveSelectionBackground': '#141828',
        'editorGutter.background': '#0a0d14',
        'editorWidget.background': '#0d1220',
        'editorSuggestWidget.background': '#0d1220',
        'editorSuggestWidget.border': '#1a2a4a',
        'editorSuggestWidget.selectedBackground': '#1a2a4a',
        'input.background': '#0d1220',
        'input.border': '#1a2a4a',
        'scrollbarSlider.background': '#1a2a4a',
        'scrollbarSlider.hoverBackground': '#243060',
        'scrollbarSlider.activeBackground': '#2a3a5a',
      },
    },
    xtermTheme: {
      background: '#0a0d14',
      foreground: '#6ab4fa',
      cursor: '#6ab4fa',
      cursorAccent: '#0a0d14',
      selectionBackground: '#1a2a4a55',
      black: '#0a0d14', red: '#cc4444', green: '#44aa88', yellow: '#aacc44',
      blue: '#6ab4fa', magenta: '#8888cc', cyan: '#44aacc', white: '#aaccee',
      brightBlack: '#2a3a5a', brightRed: '#ff5555', brightGreen: '#44ccaa',
      brightYellow: '#ccee44', brightBlue: '#88ccff', brightMagenta: '#aaaaff',
      brightCyan: '#44ccff', brightWhite: '#cce8ff',
    },
  },
}

export function getTheme(key: string): AppTheme {
  return THEMES[key] ?? THEMES['dark']
}
