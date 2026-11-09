export type AvatarId = 1 | 2 | 3 | 4;

export interface AvatarConfig {
  readonly id: AvatarId;
  readonly label: `Avatar ${AvatarId}`;
  /** Repository-relative path; Vite serves assets/ as its public directory. */
  readonly sourcePath: string;
  readonly manifestPath: string;
}

export const avatarsConfig = Object.freeze({
  referenceImage: 'assets/owner/avatar.png',
  avatars: Object.freeze([
    { id: 1, label: 'Avatar 1', sourcePath: 'assets/owner/konusan-avatar-katman-varlik-seti-1.png', manifestPath: 'assets/derived/avatar-1/manifest.json' },
    { id: 2, label: 'Avatar 2', sourcePath: 'assets/owner/konusan-avatar-katman-seti-2.png', manifestPath: 'assets/derived/avatar-2/manifest.json' },
    { id: 3, label: 'Avatar 3', sourcePath: 'assets/owner/konusan-avatar-turkce-spritesheet-i-3.png', manifestPath: 'assets/derived/avatar-3/manifest.json' },
    { id: 4, label: 'Avatar 4', sourcePath: 'assets/owner/yuz-animasyon-sprite-atlasi-4.png', manifestPath: 'assets/derived/avatar-4/manifest.json' },
  ].map(avatar => Object.freeze(avatar)) as readonly AvatarConfig[]),
});

export function selectableAvatars(): readonly AvatarConfig[] {
  return avatarsConfig.avatars;
}
