export const COLORS = {
  orange: '#f97316',
  orangeHover: '#ea580c',
  success: '#4ade80',
  warning: '#fb923c',
  error: '#ef4444',
  info: '#3b82f6',
} as const

export const WINDOW_SIZES = {
  main: { width: 1400, height: 900 },
  project: { width: 1200, height: 850 },
  settings: { width: 500, height: 550 },
} as const

export const PANEL_SIZES = {
  sidebar: { min: 160, max: 240, default: 200 },
  terminal: { min: 300, max: 550, default: 400 },
  chatDrawer: 380,
  briefingDrawer: 400,
} as const
