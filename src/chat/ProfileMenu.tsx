import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, LogIn, LogOut, UserRound } from 'lucide-react';
import { ROLE_OPTIONS, cleanName, roleLabel, type Profile, type ProfileRole } from './profile.ts';

/** Sayfanın sağ üstündeki demo giriş: ad ve rol. Asistan yanıtlarını ve bilgi tabanı erişimini bu belirler. */
export default function ProfileMenu({ profile, onChange }: { profile: Profile | null; onChange: (profile: Profile | null) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile?.name ?? '');
  const [role, setRole] = useState<ProfileRole>(profile?.role ?? 'employee');
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(profile?.name ?? ''); setRole(profile?.role ?? 'employee'); }, [profile]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const valid = cleanName(name).length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!valid) return;
    const next = { name: cleanName(name), role };
    if (next.name !== profile?.name || next.role !== profile?.role) onChange(next);
    setOpen(false);
  };
  return <div ref={root} className={`profile-menu${open ? ' open' : ''}`}>
    <button type="button" className="profile-toggle" aria-haspopup="dialog" aria-expanded={open} data-role={profile?.role ?? 'guest'} onClick={() => setOpen(!open)}>
      {profile ? <><span className="profile-avatar" aria-hidden="true">{profile.name.slice(0, 1).toLocaleUpperCase('tr-TR')}</span><span className="profile-text"><strong>{profile.name}</strong><small>{roleLabel(profile.role)}</small></span></>
        : <><LogIn size={16} strokeWidth={1.9} aria-hidden="true" /><span className="profile-text"><strong>Giriş yap</strong></span></>}
      <ChevronDown size={14} className="profile-chevron" aria-hidden="true" />
    </button>
    {open && <form className="profile-panel" role="dialog" aria-label="Demo giriş" onSubmit={submit}>
      <label><span>Adınız</span><span className="profile-field"><UserRound size={15} aria-hidden="true" /><input ref={input} value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder="Adınızı yazın" autoComplete="off" aria-label="Adınız" /></span></label>
      <fieldset><legend>Rol</legend>{ROLE_OPTIONS.map(option => <label key={option.value} className={role === option.value ? 'selected' : ''}><input type="radio" name="profile-role" value={option.value} checked={role === option.value} onChange={() => setRole(option.value)} />{option.label}</label>)}</fieldset>
      <p>Demo giriş: parola istenmez. Asistan adınıza ve rolünüze göre yanıt verir; yalnızca rolünüze açık belgeleri kullanır.</p>
      <div className="profile-actions">
        {profile && <button type="button" className="profile-logout" onClick={() => { onChange(null); setOpen(false); }}><LogOut size={14} aria-hidden="true" />Çıkış</button>}
        <button type="submit" className="profile-submit" disabled={!valid}>{profile ? 'Güncelle' : 'Giriş yap'}</button>
      </div>
    </form>}
  </div>;
}
