import { forwardRef, useId, type ButtonHTMLAttributes } from 'react';
import { NavLink } from 'react-router-dom';
import '../theme';
import './components.css';

export function AtolyeGezinmesi() {
  return <nav className="atelier navigation" aria-label="Çalışma alanları">
    <NavLink className="brand" to="/">Avatar Atölyesi<span className="caption">Hareket ve ses denemeleri</span></NavLink>
    <div className="nav-links"><NavLink to="/" end>Deneme alanı</NavLink><NavLink to="/kalite">Kalite kaydı</NavLink><NavLink to="/gorsel">Görsel inceleme</NavLink></div>
  </nav>;
}

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'stop' | 'icon' | 'launcher';
} & ({ disabled: true; disabledReason: string } | { disabled?: false; disabledReason?: never });

export function ActionButton({ variant = 'secondary', disabledReason, children, className = '', ...props }: ActionProps) {
  const reasonId = useId();
  return <span className="atelier action-wrap">
    <button {...props} type={props.type ?? 'button'} className={`action ${variant} ${className}`}
      aria-describedby={[props['aria-describedby'], props.disabled ? reasonId : undefined].filter(Boolean).join(' ') || undefined}>{children}</button>
    {props.disabled && <span id={reasonId} className="caption">{disabledReason}</span>}
  </span>;
}

export type AvatarNumber = 1 | 2 | 3 | 4;
export interface AvatarSelectProps {
  options: readonly AvatarNumber[];
  value: AvatarNumber;
  onChange: (value: AvatarNumber) => void;
  label?: string;
}
export function AvatarSelect({ options, value, onChange, label = 'Denenecek avatar' }: AvatarSelectProps) {
  const name = useId();
  return <fieldset className="atelier avatar-select"><legend>{label}</legend><div className="avatar-options">
    {[...new Set(options)].sort((a, b) => a - b).map(number => <label key={number}>
      <input type="radio" name={name} value={number} checked={value === number} onChange={() => onChange(number)} />
      <span>Avatar {number}</span>
    </label>)}
  </div></fieldset>;
}

export interface AvatarStageProps {
  avatar: AvatarNumber;
  state: 'idle' | 'speaking' | 'thinking' | 'loading' | 'error';
  showFps?: boolean;
  fps?: number;
}
const stateLabels = { idle: 'Bekleme', speaking: 'Konuşma', thinking: 'Düşünme', loading: 'Yükleniyor', error: 'Yükleme hatası' };
export const AvatarStage = forwardRef<HTMLCanvasElement, AvatarStageProps>(function AvatarStage({ avatar, state, showFps = false, fps }, ref) {
  return <figure className="atelier stage" aria-label={`Avatar ${avatar} gösterimi`}>
    <div className="stage-top"><span className="badge">Avatar {avatar}</span><span className="caption">{state === 'loading' ? 'Gösterim hazırlanıyor' : 'Avatar gösterimi'}</span></div>
    <div className="stage-content"><canvas ref={ref} width={640} height={360} aria-label={`Avatar ${avatar} animasyon tuvali`} />
      {state === 'loading' && <div className="stage-message"><span className="stage-loader" aria-hidden="true" /><strong>Avatar yükleniyor...</strong><p className="caption">Yüz ve hareket katmanları hazırlanıyor.</p></div>}
    </div>
    <figcaption className="stage-footer"><span className="badge" role="status">{stateLabels[state]}</span>{showFps && <span className="caption">{fps === undefined ? 'Kare hızı henüz ölçülmedi' : `${fps} FPS`}</span>}</figcaption>
  </figure>;
});

type NoticeProps = { title: string; description: string } & (
  { variant: 'error'; onRetry: () => void } | { variant?: 'info' | 'warning'; onRetry?: never }
);
export function Notice(props: NoticeProps) {
  const id = useId();
  return <div className={`atelier notice ${props.variant ?? 'info'}`} role={props.variant === 'error' ? 'alert' : 'status'} aria-labelledby={id}>
    <span className="notice-symbol" aria-hidden="true">{props.variant === 'info' || !props.variant ? 'i' : '!'}</span>
    <div><strong id={id}>{props.title}</strong><p>{props.description}</p>{props.variant === 'error' && <ActionButton onClick={props.onRetry}>Yeniden dene</ActionButton>}</div>
  </div>;
}

export interface SpeechSettings { text: string; voice: string; rate: number; pitch: number }
export interface SpeechFormProps {
  value: SpeechSettings;
  voices: readonly { id: string; label: string }[];
  onChange: (value: SpeechSettings) => void;
}
export function SpeechForm({ value, voices, onChange }: SpeechFormProps) {
  const id = useId();
  return <div className="atelier speech-form stack">
    <label htmlFor={`${id}-text`}>Seslendirilecek metin <span className="caption">Türkçe</span></label>
    <textarea id={`${id}-text`} rows={4} value={value.text} onChange={e => onChange({ ...value, text: e.target.value })} />
    <details open><summary>Ses ayarları</summary><div className="stack">
      <label>Türkçe ses<select value={value.voice} disabled={!voices.length} onChange={e => onChange({ ...value, voice: e.target.value })}>
        {!voices.length && <option value="">Türkçe ses bulunamadı</option>}
        {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
      </select></label>
      {!voices.length && <p className="caption">Türkçe ses bulunamadı. Bekleme ve düşünme animasyonlarını deneyebilirsiniz.</p>}
      <div className="settings-grid">{(['rate', 'pitch'] as const).map(key => <label key={key}>{key === 'rate' ? 'Hız' : 'Perde'}<input type="number" min={key === 'rate' ? 0.5 : 0} max={2} step={0.1} value={value[key]} onChange={e => { if (e.target.validity.valid && Number.isFinite(e.target.valueAsNumber)) onChange({ ...value, [key]: e.target.valueAsNumber }); }} /></label>)}</div>
      <p className="caption">1,0 varsayılan değerdir. Ayarlar avatar değişiminde korunur.</p>
    </div></details>
  </div>;
}

export type ReviewValue = 'unreviewed' | 'clear' | 'defect';
export function ReviewItem({ title, description, value = 'unreviewed', note = '', onChange }: {
  title: string; description: string; value?: ReviewValue; note?: string;
  onChange: (value: ReviewValue, note: string) => void;
}) {
  const id = useId();
  return <section className="atelier review-item stack" aria-labelledby={id}>
    <div><h3 id={id}>{title}</h3><p className="caption">{description}</p></div>
    <label>Gözlem<select value={value} onChange={e => onChange(e.target.value as ReviewValue, note)}><option value="unreviewed">Değerlendirilmedi</option><option value="clear">Kusur gözlenmedi</option><option value="defect">Kusur gözlendi</option></select></label>
    <label>Kusur veya gözlem notu<textarea rows={2} placeholder="Gözleminizi yazın" value={note} onChange={e => onChange(value, e.target.value)} /></label>
  </section>;
}

export function SourceCard({ title, path, relationship, missingNote }: { title: string; path: string; relationship: string; missingNote?: string }) {
  return <article className="atelier source-card stack"><div className="source-heading"><h3>{title}</h3><span className="badge">Kaynak</span></div><dl className="metadata">
    <dt>Orijinal dosya</dt><dd><code>{path}</code></dd><dt>Kaynak ilişkisi</dt><dd>{relationship}</dd>
  </dl>{missingNote && <p className="caption">{missingNote}</p>}</article>;
}
