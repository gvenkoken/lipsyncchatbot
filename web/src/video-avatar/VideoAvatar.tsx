import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AvatarPlayer, type AvatarState } from './player.ts';

// Varlıklar yalnızca bu bileşen ilk kez göründüğünde (sohbet kutusu açılınca) indirilir.
let cached: Promise<AvatarPlayer> | undefined;
const load = () => cached ??= AvatarPlayer.load().catch(error => { cached = undefined; throw error; });

type Props = { state: Exclude<AvatarState, 'speaking'>; onReady: (player: AvatarPlayer) => void; onState: (state: AvatarState) => void };

export default function VideoAvatar({ state, onReady, onState }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [player, setPlayer] = useState<AvatarPlayer>();
  const [error, setError] = useState('');
  const callbacks = useRef({ onReady, onState }); callbacks.current = { onReady, onState };
  useEffect(() => {
    let cancelled = false;
    void load().then(value => { if (!cancelled) setPlayer(value); }).catch(reason => { if (!cancelled) setError((reason as Error).message || 'Avatar yüklenemedi.'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!player || !canvas.current) return;
    player.onState = next => callbacks.current.onState(next);
    player.attach(canvas.current); callbacks.current.onReady(player);
    return () => { player.stop(); player.detach(); player.onState = undefined; };
  }, [player]);
  useEffect(() => { player?.setState(state); }, [player, state]);
  return <>
    <canvas ref={canvas} className="video-avatar-canvas" role="img" aria-label="PMI Assistant video avatarı" data-ready={!!player} />
    {!player && <div className="avatar-loading" role="status">{!error && <LoaderCircle size={22} className="spin" />}{error || 'Avatar hazırlanıyor…'}</div>}
  </>;
}
