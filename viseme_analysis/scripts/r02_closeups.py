"""Baş hareketi telafi edilmiş fark haritaları ve büyük yakın planlar (burun kanatları + ağız)."""
import sys, json
from pathlib import Path
import numpy as np, cv2
R = Path(sys.argv[1]); files = sorted((R / 'frames').glob('f*.png')); FPS = 30
AV = (24, 78, 430, 426)
fr = np.stack([cv2.imread(str(p))[AV[1]:AV[3], AV[0]:AV[2]] for p in files]); g = fr.astype(np.float32).mean(-1)
S0, S1 = 466, 673
REF = 440  # konuşmadan hemen önce, ağız kapalı
UP = (110, 20, 300, 120)  # alın+kaş: hizalama bölgesi (yamadan uzak)
def shift(i):
    a = g[REF][UP[1]:UP[3], UP[0]:UP[2]]; b = g[i][UP[1]:UP[3], UP[0]:UP[2]]
    (dx, dy), _ = cv2.phaseCorrelate(a, b, cv2.createHanningWindow(a.shape[::-1], cv2.CV_32F)); return dx, dy
sh = np.array([shift(i) for i in range(len(fr))])
def aligned(i):
    M = np.float32([[1, 0, -sh[i, 0]], [0, 1, -sh[i, 1]]]); return cv2.warpAffine(fr[i], M, fr[i].shape[1::-1], flags=cv2.INTER_LINEAR)
al = np.stack([aligned(i) for i in range(S0 - 30, S1 + 30)]).astype(np.float32); ag = al.mean(-1); off = S0 - 30
ref = aligned(REF).astype(np.float32).mean(-1)
dev = np.abs(ag - ref)
mx = dev[30:-30].max(0); mean = dev[30:-30].mean(0)
CL = (110, 110, 300, 290)
def crop(a): return a[CL[1]:CL[3], CL[0]:CL[2]]
def big(a, s=4, interp=cv2.INTER_LANCZOS4): return cv2.resize(a, None, fx=s, fy=s, interpolation=interp)
hm = lambda a, k: cv2.applyColorMap(np.clip(a * k, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
base = big(crop(fr[REF]))
cv2.imwrite(str(R / 'aligned_heat.png'), np.hstack([base, big(crop(hm(mx, 5)), interp=cv2.INTER_NEAREST), big(crop(hm(mean, 14)), interp=cv2.INTER_NEAREST)]))
# yatay profil: burun kanadı yüksekliğinde ve dudak yüksekliğinde ortalama sapma
rows = {}
for name, (y0, y1) in dict(burun_kanadi=(190, 205), ust_dudak_ustu=(205, 218), dudak=(222, 240), cene=(255, 275)).items():
    rows[name] = [round(float(v), 1) for v in mean[y0:y1].mean(0)[110:300:10]]
# kare bazlı: yama kenarında (burun yanları) ani sıçrama = dikiş titremesi
SIDE_L = (150, 180, 180, 215); SIDE_R = (232, 180, 262, 215); PHIL = (188, 198, 224, 218)
def series(r): return dev[:, r[1]:r[3], r[0]:r[2]].mean((1, 2))
sl, sr_, ph = series(SIDE_L), series(SIDE_R), series(PHIL)
tjump = lambda s: [(int(i + off + 1), round(float(v), 1)) for i, v in sorted(enumerate(np.abs(np.diff(s))), key=lambda t: -t[1])[:8]]
print(json.dumps(dict(shift_range=[sh[S0:S1].min(0).round(2).tolist(), sh[S0:S1].max(0).round(2).tolist()], shift_idle_sd=sh[200:440].std(0).round(2).tolist(), shift_speak_sd=sh[S0:S1].std(0).round(2).tolist(), rows=rows,
  side_mean=dict(L=float(sl[30:-30].mean()), R=float(sr_[30:-30].mean()), phil=float(ph[30:-30].mean()), L_idle=float(sl[:25].mean()), R_idle=float(sr_[:25].mean())), jumps_L=tjump(sl), jumps_R=tjump(sr_))))
np.save(R / 'shift.npy', sh)
def sheet(idx, name, cols=4, s=4, diff=False):
    tiles = []
    for i in idx:
        t = big(crop(fr[i]), s)
        if diff: t = np.hstack([t, big(crop(hm(dev[i - off], 6)), s, cv2.INTER_NEAREST)])
        cv2.putText(t, f'#{i+1} {i/FPS:.2f}s', (8, 28), cv2.FONT_HERSHEY_SIMPLEX, .8, (0, 255, 255), 2, cv2.LINE_AA); tiles.append(t)
    while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(str(R / name), np.vstack([np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]))
for k, st in enumerate(range(S0 - 2, S1 + 6, 8)): sheet(range(st, st + 8), f'big_{k:02d}.png')
# en yüksek yan-burun sapmalı kareler, fark haritasıyla
worst = np.argsort(-(sl + sr_))[:8] + off
sheet(sorted(worst.tolist()), 'worst_sides.png', cols=2, s=4, diff=True)
print('worst', sorted((worst + 1).tolist()))
