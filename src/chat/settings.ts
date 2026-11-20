export const MODES = [{ value: 'video', label: 'Video avatar' }, { value: 'local', label: 'Avatar + OpenAI' }, { value: 'synthesia', label: 'Synthesia' }, { value: 'gemini', label: 'Gemini' }] as const;
export const SYNTHESIA_AVATARS = [{ value: 'default', label: 'Synthesia avatarı' }, { value: 'custom', label: 'Bizim karakter' }] as const;
export type AvatarChoice = (typeof SYNTHESIA_AVATARS)[number]['value'];
export type Settings = { mode: (typeof MODES)[number]['value']; synthesiaAvatar: AvatarChoice; voice: boolean };
export const DEFAULT_SETTINGS: Settings = { mode: 'gemini', synthesiaAvatar: 'default', voice: true };
// Reset the previous default once; later explicit selections are still remembered.
export const SETTINGS_KEY = 'pmi-chat.settings.v5';

export function parseSettings(raw: string | null): Settings {
  try {
    const data: unknown = JSON.parse(raw ?? 'null');
    if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
    const value = data as Record<string, unknown>;
    return { mode: value.mode === 'local' || value.mode === 'gemini' || value.mode === 'synthesia' || value.mode === 'video' ? value.mode : DEFAULT_SETTINGS.mode, synthesiaAvatar: value.synthesiaAvatar === 'custom' ? 'custom' : 'default', voice: value.voice !== false };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(SETTINGS_KEY)); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { /* Settings still work for this tab when browser storage is disabled. */ }
}
