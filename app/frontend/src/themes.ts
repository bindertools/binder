import type { ITheme } from '@xterm/xterm'

export interface AppTheme {
  appBg: string
  borderColor: string
  infoBarBg: string
  infoBarColor: string
  infoBarHoverBg: string
  infoBarHoverColor: string
  tabColor: string
  tabColorHover: string
  tabAddBorder: string
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
    tabColor: '#555555',
    tabColorHover: '#999999',
    tabAddBorder: '#222222',
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

  light: {
    appBg: '#ffffff',
    borderColor: '#e5e5ea',
    infoBarBg: '#f2f2f7',
    infoBarColor: '#8e8e93',
    infoBarHoverBg: '#e5e5ea',
    infoBarHoverColor: '#1c1c1e',
    tabColor: '#8e8e93',
    tabColorHover: '#1c1c1e',
    tabAddBorder: '#c7c7cc',
    monacoThemeId: 'vs',
    xtermTheme: {
      background: '#ffffff',
      foreground: '#1c1c1e',
      cursor: '#0a84ff',
      cursorAccent: '#ffffff',
      selectionBackground: '#0a84ff33',
      black: '#1c1c1e', red: '#c41a16', green: '#007400', yellow: '#836c28',
      blue: '#0432ff', magenta: '#ad3da4', cyan: '#007d9a', white: '#6e6e73',
      brightBlack: '#636366', brightRed: '#ff453a', brightGreen: '#30d158',
      brightYellow: '#ff9f0a', brightBlue: '#0a84ff', brightMagenta: '#bf5af2',
      brightCyan: '#5ac8fa', brightWhite: '#48484a',
    },
  },
}

export function getTheme(key: string): AppTheme {
  return THEMES[key] ?? THEMES['dark']
}

// ── Color-section definitions (used by ThemeEditor) ───────────────────────────

export interface ColorSpec    { key: string; label: string }
export interface ColorSection { id: string; label: string; items: ColorSpec[] }

/** Flat color-key → human label map, grouped into sections. */
export const COLOR_SECTIONS: ColorSection[] = [
  {
    id: 'shell', label: 'Shell',
    items: [
      { key: 'shell_appBg',             label: 'App Background'          },
      { key: 'shell_borderColor',       label: 'Border Color'            },
      { key: 'shell_infoBarBg',         label: 'Info Bar Background'     },
      { key: 'shell_infoBarColor',      label: 'Info Bar Text'           },
      { key: 'shell_infoBarHoverBg',    label: 'Info Bar Hover BG'       },
      { key: 'shell_infoBarHoverColor', label: 'Info Bar Hover Text'     },
      { key: 'shell_tabColor',          label: 'Tab Text'                },
      { key: 'shell_tabColorHover',     label: 'Tab Text (Hover)'        },
    ],
  },
  {
    id: 'terminal', label: 'Terminal',
    items: [
      { key: 'term_bg',          label: 'Background'   },
      { key: 'term_fg',          label: 'Foreground'   },
      { key: 'term_cursor',      label: 'Cursor'       },
      { key: 'term_cursorAccent', label: 'Cursor Text' },
      { key: 'term_selection',   label: 'Selection'    },
    ],
  },
  {
    id: 'editor', label: 'Editor',
    items: [
      { key: 'editor_bg',            label: 'Background'         },
      { key: 'editor_fg',            label: 'Foreground'         },
      { key: 'editor_lineHighlight', label: 'Line Highlight'     },
      { key: 'editor_selection',     label: 'Selection'          },
      { key: 'editor_cursor',        label: 'Cursor'             },
      { key: 'editor_lineNum',       label: 'Line Numbers'       },
      { key: 'editor_lineNumActive', label: 'Active Line Number' },
      { key: 'editor_gutterBg',      label: 'Gutter Background'  },
      { key: 'editor_widgetBg',      label: 'Widget / Popup BG'  },
      { key: 'editor_scrollbar',     label: 'Scrollbar'          },
    ],
  },
  {
    id: 'syntax', label: 'Syntax Highlighting',
    items: [
      { key: 'syn_default',  label: 'Default Text' },
      { key: 'syn_comment',  label: 'Comments'     },
      { key: 'syn_keyword',  label: 'Keywords'     },
      { key: 'syn_string',   label: 'Strings'      },
      { key: 'syn_number',   label: 'Numbers'      },
      { key: 'syn_type',     label: 'Types / Classes' },
      { key: 'syn_function', label: 'Functions'    },
      { key: 'syn_variable', label: 'Variables'    },
      { key: 'syn_operator', label: 'Operators'    },
    ],
  },
]

/** ANSI color pairs shown in the terminal section grid. */
export const ANSI_PAIRS: { label: string; normal: string; bright: string }[] = [
  { label: 'Black',   normal: 'term_black',   bright: 'term_brightBlack'   },
  { label: 'Red',     normal: 'term_red',     bright: 'term_brightRed'     },
  { label: 'Green',   normal: 'term_green',   bright: 'term_brightGreen'   },
  { label: 'Yellow',  normal: 'term_yellow',  bright: 'term_brightYellow'  },
  { label: 'Blue',    normal: 'term_blue',    bright: 'term_brightBlue'    },
  { label: 'Magenta', normal: 'term_magenta', bright: 'term_brightMagenta' },
  { label: 'Cyan',    normal: 'term_cyan',    bright: 'term_brightCyan'    },
  { label: 'White',   normal: 'term_white',   bright: 'term_brightWhite'   },
]

// ── Converters ────────────────────────────────────────────────────────────────

/** Strip # and keep 6 hex chars — required by Monaco token rule foreground. */
function h6(color: string): string {
  return color.replace(/^#/, '').slice(0, 6)
}

/** Extract a token color from a Monaco rules array. */
function tokenColor(
  rules: { token: string; foreground?: string }[],
  token: string,
  fallback: string,
): string {
  const rule = rules.find(r => r.token === token)
  return rule?.foreground ? '#' + rule.foreground : fallback
}

/**
 * Derive a flat color-key map from an existing AppTheme (preset or saved custom).
 * Used to seed the ThemeEditor with the current theme's colors.
 */
export function themeToCustomColors(theme: AppTheme): Record<string, string> {
  const x     = theme.xtermTheme
  const rules = theme.monacoThemeDef?.rules  ?? []
  const mc    = theme.monacoThemeDef?.colors ?? {}

  return {
    // Shell
    shell_appBg:             theme.appBg,
    shell_borderColor:       theme.borderColor,
    shell_infoBarBg:         theme.infoBarBg,
    shell_infoBarColor:      theme.infoBarColor,
    shell_infoBarHoverBg:    theme.infoBarHoverBg,
    shell_infoBarHoverColor: theme.infoBarHoverColor,
    shell_tabColor:          theme.tabColor,
    shell_tabColorHover:     theme.tabColorHover,

    // Terminal
    term_bg:           x.background      ?? '#0d0d0d',
    term_fg:           x.foreground      ?? '#cccccc',
    term_cursor:       x.cursor          ?? '#cccccc',
    term_cursorAccent: x.cursorAccent    ?? '#0d0d0d',
    // Trim any alpha suffix so <input type="color"> gets a plain #rrggbb
    term_selection:    (x.selectionBackground ?? '#264f78').slice(0, 7),
    term_black:        x.black   ?? '#1a1a1a',
    term_red:          x.red     ?? '#cd3131',
    term_green:        x.green   ?? '#0dbc79',
    term_yellow:       x.yellow  ?? '#e5e510',
    term_blue:         x.blue    ?? '#2472c8',
    term_magenta:      x.magenta ?? '#bc3fbc',
    term_cyan:         x.cyan    ?? '#11a8cd',
    term_white:        x.white   ?? '#e5e5e5',
    term_brightBlack:   x.brightBlack   ?? '#666666',
    term_brightRed:     x.brightRed     ?? '#f14c4c',
    term_brightGreen:   x.brightGreen   ?? '#23d18b',
    term_brightYellow:  x.brightYellow  ?? '#f5f543',
    term_brightBlue:    x.brightBlue    ?? '#3b8eea',
    term_brightMagenta: x.brightMagenta ?? '#d670d6',
    term_brightCyan:    x.brightCyan    ?? '#29b8db',
    term_brightWhite:   x.brightWhite   ?? '#ffffff',

    // Editor
    editor_bg:            mc['editor.background']                ?? theme.appBg,
    editor_fg:            mc['editor.foreground']                ?? '#d4d4d4',
    editor_lineHighlight: mc['editor.lineHighlightBackground']   ?? '#1a1a1a',
    editor_selection:     mc['editor.selectionBackground']       ?? '#264f78',
    editor_cursor:        mc['editorCursor.foreground']          ?? '#d4d4d4',
    editor_lineNum:       mc['editorLineNumber.foreground']      ?? '#444444',
    editor_lineNumActive: mc['editorLineNumber.activeForeground']?? '#888888',
    editor_gutterBg:      mc['editorGutter.background']          ?? theme.appBg,
    editor_widgetBg:      mc['editorWidget.background']          ?? '#1a1a1a',
    editor_scrollbar:     mc['scrollbarSlider.background']       ?? '#333333',

    // Syntax (VS Dark defaults when preset has no custom rules)
    syn_default:  tokenColor(rules, '',         '#d4d4d4'),
    syn_comment:  tokenColor(rules, 'comment',  '#6a9955'),
    syn_keyword:  tokenColor(rules, 'keyword',  '#569cd6'),
    syn_string:   tokenColor(rules, 'string',   '#ce9178'),
    syn_number:   tokenColor(rules, 'number',   '#b5cea8'),
    syn_type:     tokenColor(rules, 'type',     '#4ec9b0'),
    syn_function: tokenColor(rules, 'function', '#dcdcaa'),
    syn_variable: tokenColor(rules, 'variable', '#9cdcfe'),
    syn_operator: tokenColor(rules, 'operator', '#d4d4d4'),
  }
}

/**
 * Build a full AppTheme from a flat color-key map.
 * Used when applying / live-previewing a custom theme.
 */
export function customColorsToTheme(c: Record<string, string>): AppTheme {
  const bg = c.editor_bg ?? c.shell_appBg ?? '#0d0d0d'

  return {
    appBg:             c.shell_appBg             ?? '#0d0d0d',
    borderColor:       c.shell_borderColor       ?? '#1e1e1e',
    infoBarBg:         c.shell_infoBarBg         ?? '#141414',
    infoBarColor:      c.shell_infoBarColor      ?? '#555555',
    infoBarHoverBg:    c.shell_infoBarHoverBg    ?? '#1a1a1a',
    infoBarHoverColor: c.shell_infoBarHoverColor ?? '#888888',
    tabColor:          c.shell_tabColor          ?? '#555555',
    tabColorHover:     c.shell_tabColorHover     ?? '#999999',
    tabAddBorder:      c.shell_borderColor       ?? '#222222',
    monacoThemeId: 'custom',
    monacoThemeDef: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '',         foreground: h6(c.syn_default  ?? '#d4d4d4'), background: h6(bg) },
        { token: 'comment',  foreground: h6(c.syn_comment  ?? '#6a9955'), fontStyle: 'italic' },
        { token: 'keyword',  foreground: h6(c.syn_keyword  ?? '#569cd6'), fontStyle: 'bold' },
        { token: 'string',   foreground: h6(c.syn_string   ?? '#ce9178') },
        { token: 'number',   foreground: h6(c.syn_number   ?? '#b5cea8') },
        { token: 'type',     foreground: h6(c.syn_type     ?? '#4ec9b0') },
        { token: 'function', foreground: h6(c.syn_function ?? '#dcdcaa') },
        { token: 'variable', foreground: h6(c.syn_variable ?? '#9cdcfe') },
        { token: 'operator', foreground: h6(c.syn_operator ?? '#d4d4d4') },
      ],
      colors: {
        'editor.background':                   c.editor_bg            ?? bg,
        'editor.foreground':                   c.editor_fg            ?? '#d4d4d4',
        'editor.lineHighlightBackground':      c.editor_lineHighlight ?? '#1a1a1a',
        'editor.selectionBackground':          c.editor_selection     ?? '#264f78',
        'editor.inactiveSelectionBackground':  c.editor_selection     ?? '#1a1a1a',
        'editorCursor.foreground':             c.editor_cursor        ?? '#d4d4d4',
        'editorLineNumber.foreground':         c.editor_lineNum       ?? '#444444',
        'editorLineNumber.activeForeground':   c.editor_lineNumActive ?? '#888888',
        'editorGutter.background':             c.editor_gutterBg      ?? bg,
        'editorWidget.background':             c.editor_widgetBg      ?? '#1a1a1a',
        'editorSuggestWidget.background':      c.editor_widgetBg      ?? '#1a1a1a',
        'editorSuggestWidget.border':          c.shell_borderColor    ?? '#333333',
        'editorSuggestWidget.selectedBackground': c.editor_selection  ?? '#264f78',
        'input.background':                    c.editor_widgetBg      ?? '#1a1a1a',
        'input.border':                        c.shell_borderColor    ?? '#333333',
        'scrollbarSlider.background':          c.editor_scrollbar     ?? '#333333',
        'scrollbarSlider.hoverBackground':     c.editor_scrollbar     ?? '#444444',
        'scrollbarSlider.activeBackground':    c.editor_scrollbar     ?? '#555555',
      },
    },
    xtermTheme: {
      background:          c.term_bg           ?? '#0d0d0d',
      foreground:          c.term_fg           ?? '#cccccc',
      cursor:              c.term_cursor       ?? '#cccccc',
      cursorAccent:        c.term_cursorAccent ?? '#0d0d0d',
      // Append alpha so the selection is semi-transparent
      selectionBackground: (c.term_selection ?? '#264f78') + '55',
      black:   c.term_black   ?? '#1a1a1a',
      red:     c.term_red     ?? '#cd3131',
      green:   c.term_green   ?? '#0dbc79',
      yellow:  c.term_yellow  ?? '#e5e510',
      blue:    c.term_blue    ?? '#2472c8',
      magenta: c.term_magenta ?? '#bc3fbc',
      cyan:    c.term_cyan    ?? '#11a8cd',
      white:   c.term_white   ?? '#e5e5e5',
      brightBlack:   c.term_brightBlack   ?? '#666666',
      brightRed:     c.term_brightRed     ?? '#f14c4c',
      brightGreen:   c.term_brightGreen   ?? '#23d18b',
      brightYellow:  c.term_brightYellow  ?? '#f5f543',
      brightBlue:    c.term_brightBlue    ?? '#3b8eea',
      brightMagenta: c.term_brightMagenta ?? '#d670d6',
      brightCyan:    c.term_brightCyan    ?? '#29b8db',
      brightWhite:   c.term_brightWhite   ?? '#ffffff',
    },
  }
}
