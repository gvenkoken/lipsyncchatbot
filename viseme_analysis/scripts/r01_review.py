"""Ekran kaydı incelemesi: avatar bölgesindeki kare-kare değişim, ağız/burun yakın planları, ses eşlemesi."""
import sys, json, wave
from pathlib import Path
import numpy as np, cv2
R = Path(sys.argv[1]); F = R / 'frames'
files = sorted(F.glob('f*.png')); n = len(files); FPS = 30
AV = (24, 78, 430, 426)  # x0,y0,x1,y1 avatar tuvali
frames = np.stack([cv2.imread(str(p))[AV[1]:AV[3], AV[0]:AV[2]] for p in files])
gray = frames.astype(np.float32).mean(-1)
h, w = gray.shape[1:]
# bölgeler (tuval koordinatı)
MOUTH = (150, 195, 260, 255); NOSE = (140, 130, 270, 215); EYES = (130, 110, 280, 160)
def roi(a, r): return a[:, r[1]:r[3], r[0]:r[2]]
d = np.abs(np.diff(gray, axis=0))
motion = {k: roi(d, r).mean((1, 2)) for k, r in dict(mouth=MOUTH, nose=NOSE, eyes=EYES).items()}
motion['all'] = d.mean((1, 2))
# ağız açıklığı vekili: ağız bölgesindeki koyu piksel oranı + dudak arası
mo = roi(gray, MOUTH); dark = (mo < 60).mean((1, 2))
# ses zarfı
wv = wave.open(str(R / 'audio.wav')); sr = wv.getframerate(); a = np.frombuffer(wv.readframes(wv.getnframes()), np.int16).astype(np.float32) / 32768
hop = sr // FPS; env = np.array([np.sqrt((a[i*hop:(i+1)*hop] ** 2).mean()) if len(a[i*hop:(i+1)*hop]) else 0 for i in range(n)])
speak = env > max(.01, env.max() * .08)
info = dict(n=n, audio_peak=float(np.abs(a).max()), speech_frames=[int(np.argmax(speak)), int(n - 1 - np.argmax(speak[::-1]))] if speak.any() else None)
# ilk ağız hareketi
base = np.median(gray[200:380], axis=0)  # düşünme/boşta dönemi
mdev = np.abs(roi(gray, MOUTH) - base[MOUTH[1]:MOUTH[3], MOUTH[0]:MOUTH[2]]).mean((1, 2))
info['mouth_dev_first'] = int(np.argmax(mdev > mdev[200:380].max() * 2.5))
# çapraz korelasyon: ses zarfı ile ağız sapması
if speak.any():
    s0, s1 = info['speech_frames']; best = None
    for lag in range(-12, 13):
        x = env[s0:s1]; y = mdev[s0 + lag:s1 + lag]
        if len(y) == len(x): c = np.corrcoef(x, y)[0, 1]; best = max(best or (c, lag), (c, lag))
    info['xcorr'] = dict(r=float(best[0]), lag_frames=best[1])
# konuşma sırasında değişen alan haritası (yamanın gerçek etki alanı)
if speak.any():
    seg = gray[s0:s1]; sd = seg.std(0); mx = np.abs(seg - base).max(0)
    cv2.imwrite(str(R / 'heat_std.png'), cv2.applyColorMap(np.clip(sd * 12, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO))
    hm = cv2.applyColorMap(np.clip(mx * 4, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    cv2.imwrite(str(R / 'heat_max.png'), np.hstack([cv2.resize(frames[s0 - 5], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), cv2.resize(hm, None, fx=2, fy=2), cv2.resize(cv2.addWeighted(frames[s0 - 5], .5, hm, .5, 0), None, fx=2, fy=2)]))
    idle = gray[250:380]; isd = idle.std(0)
    cv2.imwrite(str(R / 'heat_idle_std.png'), cv2.resize(cv2.applyColorMap(np.clip(isd * 30, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO), None, fx=2, fy=2))
np.savez(R / 'series.npz', env=env, mdev=mdev, dark=dark, **motion)
# yakın plan levhaları: burun+ağız, 4x, ardışık kareler
CL = (120, 120, 290, 270)
def sheet(idx, name, cols=8, scale=3):
    tiles = []
    for i in idx:
        t = cv2.resize(frames[i][CL[1]:CL[3], CL[0]:CL[2]], None, fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
        cv2.putText(t, f'{i+1} {i/FPS:.2f}s', (6, 20), cv2.FONT_HERSHEY_SIMPLEX, .55, (0, 255, 255), 1, cv2.LINE_AA); tiles.append(t)
    while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(str(R / name), np.vstack([np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]))
if speak.any():
    for k, st in enumerate(range(s0 - 6, s1 + 10, 32)): sheet(range(st, min(st + 32, n)), f'close_{k:02d}.png')
sheet(range(200, 380, 6), 'close_idle.png')
info['top_jumps'] = [(int(i + 1), round(float(motion['nose'][i]), 2)) for i in np.argsort(-motion['nose'])[:15]]
print(json.dumps(info))
