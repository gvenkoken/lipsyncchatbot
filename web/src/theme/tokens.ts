export const colors = {
  primary: '#6544C4', 'primary-soft': '#F0EBFC', background: '#F6F5F2',
  surface: '#FFFFFF', text: '#25232D', muted: '#6C6877', border: '#DEDCE4',
  stage: '#ECEAE5', success: '#267047', warning: '#875B13', 'warning-soft': '#FFF5DE',
  error: '#B13D45', 'error-soft': '#FFF0F1', info: '#315F91', 'info-soft': '#EDF4FC',
} as const;
const sans = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const typography = {
  display: { family: sans, size: 32, line: 40, weight: 600 },
  heading: { family: sans, size: 20, line: 28, weight: 600 },
  body: { family: sans, size: 15, line: 24, weight: 400 },
  label: { family: sans, size: 14, line: 20, weight: 600 },
  caption: { family: sans, size: 12, line: 18, weight: 500 },
  mono: { family: mono, size: 12, line: 20, weight: 400 },
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48 } as const;
export const radii = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const shadows = {
  card: '0 2px 8px rgba(37, 35, 45, 0.04)',
  panel: '0 16px 48px rgba(37, 35, 45, 0.14)',
  focus: '0 0 0 3px rgba(101, 68, 196, 0.22)',
} as const;
