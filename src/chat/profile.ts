// Demo giriş: ad ve rol tarayıcıda tutulur ve sohbet oturumu açılırken sunucuya gönderilir.
// Gerçek kimlik doğrulama DEĞİLDİR; üretimde rol güvenilir bir kimlik sağlayıcıdan gelmelidir.
export const ROLE_OPTIONS = [{ value: 'employee', label: 'Çalışan' }, { value: 'partner', label: 'İş ortağı' }] as const;
export type ProfileRole = (typeof ROLE_OPTIONS)[number]['value'];
export type Profile = { name: string; role: ProfileRole };
export const PROFILE_KEY = 'pmi-chat.profile.v1';
export const cleanName = (value: string) => value.replace(/[^\p{L}\p{M} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Kayıtlı profili okur; adı ya da rolü geçersizse giriş yapılmamış sayılır. */
export function parseProfile(raw: string | null): Profile | null {
  try {
    const value = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    const name = typeof value?.name === 'string' ? cleanName(value.name) : '';
    return name && ROLE_OPTIONS.some(option => option.value === value?.role) ? { name, role: value!.role as ProfileRole } : null;
  } catch { return null; }
}
export function loadProfile(): Profile | null { try { return parseProfile(localStorage.getItem(PROFILE_KEY)); } catch { return null; } }
export function saveProfile(profile: Profile | null) {
  try { if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); else localStorage.removeItem(PROFILE_KEY); } catch { /* yalnızca bu sekmede geçerli */ }
}
export const roleLabel = (role: ProfileRole) => ROLE_OPTIONS.find(option => option.value === role)!.label;
/** Canlı oturum adresine eklenen sorgu: giriş yoksa boş (sunucu misafir sayar). */
export const profileQuery = (profile: Profile | null) => profile ? `?name=${encodeURIComponent(profile.name)}&role=${profile.role}` : '';
