"""Burun kanatları yakın planı: hizalanmış kareler, referansa göre işaretli fark ve yama sınırı bindirmesi."""
import sys, json
from pathlib import Path
import numpy as np, cv2
R = Path(sys.argv[1]); ROOT = R.parents[1]; files = sorted((R / 'frames').glob('f*.png'))
AV = (24, 78, 430, 426); REF = 440; sh = np.load(R / 'shift.npy')
def load(i):
    f = cv2.imread(str(files[i]))[AV[1]:AV[3], AV[0]:AV[2]]
    return cv2.warpAffine(f, np.float32([[1, 0, -sh[i, 0]], [0, 1, -sh[i, 1]]]), f.shape[1::-1], flags=cv2.INTER_CUBIC)
ref = load(REF)
# yama alfa sınırı: atlas@2x içinden bir sprite'ın alfa kanalı -> ekran koordinatı (ölçek, göz+ağız çapalarından)
m = json.loads((ROOT / 'public/viseme-rig/manifest.json').read_text('utf8'))
atlas = cv2.imread(str(ROOT / 'public/viseme-rig/atlas@2x.webp'), cv2.IMREAD_UNCHANGED)
def alpha(name):
    x, y, w, h = m['sprites'][name]['rect']['2']; return atlas[y:y + h, x:x + w, 3], m['sprites'][name]['dest']
# ekran ölçeği: tuval 348 px kare, mantıksal 320, OVERSCAN 1.03, merkez (160,120)
S = 348 / 320; Z = 1.03; X0 = (406 - 348) / 2
def to_screen(lx, ly): return X0 + ((lx - 160) * Z + 160) * S, ((ly - 120) * Z + 120) * S
NZ = (140, 160, 266, 232); K = 8
def crop(a): return cv2.resize(a[NZ[1]:NZ[3], NZ[0]:NZ[2]], None, fx=K, fy=K, interpolation=cv2.INTER_CUBIC)
def outline(img, name, color):
    a, d = alpha(name)
    for lvl, c in ((128, color), (13, (255, 255, 0))):
        cs, _ = cv2.findContours((a >= lvl).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c0 in cs:
            pts = np.array([to_screen(d[0] + p[0][0] / 2, d[1] + p[0][1] / 2) for p in c0]) - sh[REF] * 0 
            pts = ((pts - [NZ[0], NZ[1]]) * K).astype(np.int32)
            cv2.polylines(img, [pts], True, c, 1, cv2.LINE_AA)
    return img
pick = [int(v) - 1 for v in sys.argv[2].split(',')]
rows = []
for i in pick:
    f = load(i); d = f.astype(np.int16) - ref.astype(np.int16); lum = d.mean(-1)
    sd = np.zeros_like(f); sd[..., 2] = np.clip(lum * 8, 0, 255); sd[..., 0] = np.clip(-lum * 8, 0, 255)  # kırmızı: daha parlak, mavi: daha koyu
    t = crop(f); cv2.putText(t, f'#{i+1}', (8, 30), cv2.FONT_HERSHEY_SIMPLEX, .9, (0, 255, 255), 2)
    rows.append(np.hstack([crop(ref), t, crop(sd), outline(crop(f).copy(), 'A_1', (0, 255, 0))]))
cv2.imwrite(str(R / sys.argv[3]), np.vstack(rows))
# yama içi / dışı ortalama renk farkı (ton kayması): yanak iç (yama) - yanak dış (taban), referansla karşılaştır
print('sprites dest', {k: m['sprites'][k]['dest'] for k in ['SIL_1', 'A_1', 'E_1', 'I_1', 'O_1', 'U_1']})
print('screen pts: nose_top', to_screen(160, 147), 'mouth', to_screen(160.06, 206.75), 'eyes', to_screen(160.8, 141.67))
