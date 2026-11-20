import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { MouthRenderer } from './renderer';
import { EyeMotion } from './eyes';

export type AvatarMode = 'idle' | 'thinking' | 'speaking' | 'listening';
let cachedRig: Promise<MouthRenderer> | undefined;
function loadRig() {
  if (!cachedRig) cachedRig = MouthRenderer.load().catch(error => { cachedRig = undefined; throw error; });
  return cachedRig;
}

export default function Avatar({ frame, mode }: { frame: number; mode: AvatarMode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rig, setRig] = useState<MouthRenderer>();
  const [eye, setEye] = useState(1);
  const [motion] = useState(() => new EyeMotion());
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadRig().then(value => { if (!cancelled) setRig(value); }).catch(reason => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (rig && canvas.current) rig.render(canvas.current.getContext('2d')!, frame, false, eye);
  }, [rig, frame, eye]);
  useEffect(() => {
    if (!rig) return;
    let raf = 0, last = -1;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      if (document.hidden) return;
      const next = motion.sample(now, mode, !preference.matches);
      if (next !== last) { last = next; setEye(next); }
      raf = requestAnimationFrame(tick);
    };
    const resume = () => { cancelAnimationFrame(raf); motion.reset(performance.now()); if (!document.hidden) raf = requestAnimationFrame(tick); };
    document.addEventListener('visibilitychange', resume); preference.addEventListener('change', resume);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', resume); preference.removeEventListener('change', resume); };
  }, [rig, mode, motion]);
  return <>
    <canvas ref={canvas} className="avatar-canvas" width={1122} height={1117} role="img" aria-label="PMI Assistant avatarı" data-ready={!!rig} data-frame={frame} data-eye={eye} data-mode={mode} />
    {!rig && <div className="avatar-loading" role="status">{!error && <LoaderCircle size={22} className="spin" />}{error || 'Avatar hazırlanıyor…'}</div>}
    {mode === 'thinking' && <div className="thought" aria-hidden="true"><i /><i /><i /></div>}
  </>;
}
