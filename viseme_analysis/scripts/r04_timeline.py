"""Zaman çizelgesi (arayüz olayları), ses-ağız eşlemesi, burun asimetrisi ve kare sıçramaları."""
import sys, json, wave
from pathlib import Path
import numpy as np, cv2
R = Path(sys.argv[1]); files = sorted((R / 'frames').glob('f*.png')); FPS = 30; n = len(files)
full = np.stack([cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) for p in files]).astype(np.float32)
AV = (24, 78, 430, 426); sh = np.load(R / 'shift.npy'); REF = 440
def ev(region, thr=1.0):
    x0, y0, x1, y1 = region; d = np.abs(np.diff(full[:, y0:y1, x0:x1], axis=0)).mean((1, 2)); return [(int(i + 1), round(float(v), 1)) for i, v in enumerate(d) if v > thr]
print('etiket', ev((40, 380, 180, 410), 2)); print('sohbet', ev((30, 560, 420, 750), .8)); print('girdi', ev((40, 770, 350, 825), 1.5)[:3], '...', ev((40, 770, 350, 825), 1.5)[-3:])
g = np.stack([cv2.warpAffine(full[i][AV[1]:AV[3], AV[0]:AV[2]], np.float32([[1, 0, -sh[i, 0]], [0, 1, -sh[i, 1]]]), (406, 348)) for i in range(n)])
ref = g[REF]; dev = np.abs(g - ref)
MOUTH = (165, 212, 242, 250)
# ağız açıklığı: dudak arası koyu/diş alanı = referanstan sapma
mo = dev[:, MOUTH[1]:MOUTH[3], MOUTH[0]:MOUTH[2]].mean((1, 2))
wv = wave.open(str(R / 'audio.wav')); sr = wv.getframerate(); a = np.frombuffer(wv.readframes(wv.getnframes()), np.int16).astype(np.float32) / 32768
hop = sr // 100; e100 = np.array([np.sqrt((a[i * hop:(i + 1) * hop] ** 2).mean()) for i in range(len(a) // hop)])
thr = e100.max() * .06; sp = e100 > thr
# konuşma bölgeleri (10 ms)
regs = []; i = 0
while i < len(sp):
    if sp[i]:
        j = i
        while j < len(sp) and (sp[j] or (j + 8 < len(sp) and sp[j:j + 8].any())): j += 1
        if j - i >= 4: regs.append((i / 100, j / 100))
        i = j
    else: i += 1
print('ses bölgeleri', [(round(s, 2), round(t, 2)) for s, t in regs])
mthr = 4.0; op = mo > mthr
mregs = []; i = 0
while i < n:
    if op[i]:
        j = i
        while j < n and op[j]: j += 1
        mregs.append((round(i / FPS, 2), round(j / FPS, 2))); i = j
    else: i += 1
print('ağız açık bölgeleri', mregs)
print('ağız sapması 455-480', [round(float(v), 1) for v in mo[455:480]])
print('ağız sapması 665-700', [round(float(v), 1) for v in mo[665:700]])
env30 = np.array([e100[int(i * 100 / FPS):int((i + 1) * 100 / FPS) + 1].mean() for i in range(n)])
s0, s1 = 466, 673
for lag in range(-6, 7): print(lag, round(float(np.corrcoef(env30[s0:s1], mo[s0 + lag:s1 + lag])[0, 1]), 3), end=' | ')
print()
# burun: sol/sağ kanat bölgesinde işaretli parlaklık farkı -> asimetri ve titreme
sg = g - ref
NL = (172, 188, 196, 208); NR = (210, 188, 234, 208); CL = (150, 182, 176, 212); CR = (230, 182, 256, 212)
f = lambda r: sg[:, r[1]:r[3], r[0]:r[2]].mean((1, 2))
nl, nr, cl, cr = f(NL), f(NR), f(CL), f(CR)
st = lambda x: dict(mean=round(float(x[s0:s1].mean()), 2), sd=round(float(x[s0:s1].std()), 2), min=round(float(x[s0:s1].min()), 1), max=round(float(x[s0:s1].max()), 1), idle_sd=round(float(x[250:440].std()), 2), d_sd=round(float(np.diff(x[s0:s1]).std()), 2), d_max=round(float(np.abs(np.diff(x[s0:s1])).max()), 1))
print(json.dumps(dict(burun_sol=st(nl), burun_sag=st(nr), yanak_sol=st(cl), yanak_sag=st(cr), asimetri=st(nl - nr))))
# burun deliği konumu: referansa göre yerel kayma (yama içindeki burun alt yarısı taban üst yarısına göre kayıyor mu?)
NB = (176, 178, 232, 212); w = cv2.createHanningWindow((NB[2] - NB[0], NB[3] - NB[1]), cv2.CV_32F)
loc = np.array([cv2.phaseCorrelate(ref[NB[1]:NB[3], NB[0]:NB[2]], g[i][NB[1]:NB[3], NB[0]:NB[2]], w)[0] for i in range(n)])
print('burun alt yarı kayması px (konuşma) min/max/sd', loc[s0:s1].min(0).round(2), loc[s0:s1].max(0).round(2), loc[s0:s1].std(0).round(2), 'boşta sd', loc[250:440].std(0).round(2))
big = np.argsort(-np.abs(np.diff(loc[s0:s1], axis=0)).sum(1))[:8] + s0 + 1
print('burun sıçrama kareleri', sorted((big + 1).tolist()))
np.savez(R / 'series2.npz', mo=mo, env30=env30, nl=nl, nr=nr, cl=cl, cr=cr, loc=loc)
