"""ADIM 8 – Viseme tabanlı sentez ve gerçek video ile yan yana karşılaştırma.
Kullanım: python s08_synth.py [süre_saniye=15] [başlangıç_saniye=0]
Çıktılar: out/comparison.mp4 (gerçek | sentez, 1080x580 + ses)
          out/comparison_zoom.mp4 (alt yüz yakın plan, tam ekran kalitesini görmek için)
          out/synth_only.mp4
"""
import subprocess
import sys

import cv2
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

from common import OUT, FFMPEG, VIDEO, iter_frames, load_json, video_info, CHIN, NOSE_TIP, JAW_LINE
from compositor import Compositor

DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 15.0
T0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
XFADE = 0.060
info = video_info()
FPS, W, H = info["fps"], info["w"], info["h"]
vis = pd.read_csv(OUT / "visemes.csv").fillna({"coart_vowel": ""})
idle = load_json(OUT / "idle" / "idle.json")
A_ALL = np.load(OUT / "align_affine.npy")
pmeta = load_json(OUT / "patches" / "patches.json")["patches"]
comp = Compositor()
idle_frames = [cv2.imread(str(OUT / "idle" / "frames" / f)) for f in idle["frames"]]
M_from = idle["affine_from_ref"]
L = len(idle_frames)
ORDER = idle.get("playback_order_pingpong", list(range(L)))   # ping-pong: dikiş sıçraması yok
SIL_PATCH = None if idle["mode"] == "strict" else "SIL_1.png"   # strict tabanda ağız zaten kapalı


def patch_for(v, coart):
    if v == "SIL":
        return SIL_PATCH
    if v == "KG" and coart and f"{coart}_1.png" in pmeta:   # k/g/h/y komşu ünlünün şeklini alır
        return f"{coart}_1.png"
    name = f"{v}_1.png"
    return name if name in pmeta else SIL_PATCH


segs = [(r.start, r.end, patch_for(r.viseme, r.coart_vowel), r.viseme) for r in vis.itertuples()]
starts = np.array([s[0] for s in segs])

n_out = int(round(DUR * FPS))
f0 = int(round(T0 * FPS))
times = (np.arange(n_out) + f0 + 0.5) / FPS

# 25 fps'te 40 ms'den kısa dudak kapanmaları (PBM/FV) hiçbir kareye düşmeyebilir: en yakın kareye zorla
forced = {}
for s, e, p, v in segs:
    if v in ("PBM", "FV") and s < times[-1] and e > times[0]:
        inside = np.where((times >= s) & (times < e))[0]
        if len(inside) == 0:
            k = int(np.argmin(np.abs(times - (s + e) / 2)))
            forced[k] = (p, v)


def layers_at(k, t):
    if k in forced:
        return [(forced[k][0], 1.0)], forced[k][1]
    j = int(np.clip(np.searchsorted(starts, t, side="right") - 1, 0, len(segs) - 1))
    s, e, p, v = segs[j]
    lay = {p: 1.0}
    if t - s < XFADE / 2 and j > 0:                       # önceki viseme'den geçiş
        w = 0.5 - (t - s) / XFADE
        pp = segs[j - 1][2]
        lay = {}
        lay[pp] = lay.get(pp, 0) + w
        lay[p] = lay.get(p, 0) + 1 - w
    elif e - t < XFADE / 2 and j < len(segs) - 1:         # sonraki viseme'ye geçiş
        w = 0.5 - (e - t) / XFADE
        nn = segs[j + 1][2]
        lay = {}
        lay[nn] = lay.get(nn, 0) + w
        lay[p] = lay.get(p, 0) + 1 - w
    return list(lay.items()), v


try:
    FONT = ImageFont.truetype("arialbd.ttf", 22)
except OSError:
    FONT = ImageFont.load_default()


def bar(text_l, text_r, width, h=40):
    im = Image.new("RGB", (width, h), (24, 24, 24))
    dr = ImageDraw.Draw(im)
    dr.text((12, 8), text_l, font=FONT, fill=(230, 230, 230))
    dr.text((width // 2 + 12, 8), text_r, font=FONT, fill=(255, 210, 70))
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


def ff_writer(path, w, h, with_audio=True):
    cmd = [FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(FPS),
           "-i", "-"]
    if with_audio:
        cmd += ["-ss", f"{f0 / FPS:.3f}", "-t", f"{DUR:.3f}", "-i", str(VIDEO), "-map", "0:v", "-map", "1:a",
                "-c:a", "aac", "-b:a", "160k"]
    cmd += ["-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", "-shortest", str(path)]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


# yakın plan kırpma (referans karedeki alt yüz, idle karesinin koordinatına çevrilmiş sabit kutu)
d = np.load(OUT / "landmarks.npz")
ref_lm = d["lm"][load_json(OUT / "stability.json")["reference_frame"], :, :2]
zx0, zx1 = int(ref_lm[JAW_LINE, 0].min() - 30), int(ref_lm[JAW_LINE, 0].max() + 30)
zy0 = int(ref_lm[NOSE_TIP, 1] - 80)
zy1 = zy0 + (zx1 - zx0)  # kare kırp

w_main = ff_writer(OUT / "comparison.mp4", 1080, 580)
w_zoom = ff_writer(OUT / "comparison_zoom.mp4", 1080, 580)
w_syn = ff_writer(OUT / "synth_only.mp4", W, H)
for k, (fi, real) in enumerate(iter_frames(f0, f0 + n_out)):
    t = times[k]
    b = ORDER[k % len(ORDER)]
    lay, v = layers_at(k, t)
    syn = comp.render(idle_frames[b], lay, M_from[b])
    w_syn.stdin.write(syn.tobytes())
    label = " + ".join(f"{(n or 'taban').replace('_1.png','')}:{w:.2f}" for n, w in lay if w > 0.01)
    top = bar(f"Gerçek  t={t:5.2f}s", f"Sentez  {v}  [{label}]", 1080)
    side = np.hstack([cv2.resize(real, (540, 540), interpolation=cv2.INTER_AREA),
                      cv2.resize(syn, (540, 540), interpolation=cv2.INTER_AREA)])
    w_main.stdin.write(np.vstack([top, side]).tobytes())
    # yakın plan: gerçek karede kendi alt yüzü (kendi hizalamasıyla), sentezde idle karesininki
    A_real = A_ALL[fi]
    real_al = cv2.warpAffine(real, np.array(A_real), (W, H))
    syn_al = cv2.warpAffine(syn, np.array(idle["affine_to_ref"][b]), (W, H))
    zr = cv2.resize(real_al[zy0:zy1, zx0:zx1], (540, 540), interpolation=cv2.INTER_CUBIC)
    zs = cv2.resize(syn_al[zy0:zy1, zx0:zx1], (540, 540), interpolation=cv2.INTER_CUBIC)
    w_zoom.stdin.write(np.vstack([top, np.hstack([zr, zs])]).tobytes())
    # kontrol için birkaç kareyi PNG olarak sakla
    if k % 50 == 25:
        (OUT / "synth_check").mkdir(exist_ok=True)
        cv2.imwrite(str(OUT / "synth_check" / f"cmp_{k:04d}.jpg"), np.vstack([top, np.hstack([zr, zs])]))
for w in (w_main, w_zoom, w_syn):
    w.stdin.close(); w.wait()
print(f"Yazıldı: comparison.mp4, comparison_zoom.mp4, synth_only.mp4 ({n_out} kare, {len(forced)} zorlanmış PBM/FV karesi)")
