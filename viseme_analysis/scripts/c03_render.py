"""AŞAMA C – Kalibrasyon cümlelerini avatarla render eder (sol: alignText, sağ: Whisper referansı) -> out_v2/render/<id>.mp4
Önce: node scripts/avatar-render-frames.mjs s00 s02 ...
Not: baş hareketi ve göz kırpma tarayıcıdaki oynatıcıya özgüdür; burada yalnızca ağız senkronu görülür.
"""
import json
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import FFMPEG, ROOT

RIG = ROOT.parent / "public" / "viseme-rig"
R = ROOT / "out_v2" / "render"
man = json.loads((RIG / "manifest.json").read_text(encoding="utf-8"))
atlas = cv2.cvtColor(np.array(Image.open(RIG / man["atlases"]["2"]["file"]).convert("RGBA")), cv2.COLOR_RGBA2BGRA).astype(np.float32)


def sprite(name):
    x, y, w, h = man["sprites"][name]["rect"]["2"]
    dx, dy = (int(round(v * 2)) for v in man["sprites"][name]["dest"][:2])
    return atlas[y:y + h, x:x + w], dx, dy


base = sprite(man["base"])[0][..., :3]
N = base.shape[0]
try:
    FONT = ImageFont.truetype("arialbd.ttf", 20); SMALL = ImageFont.truetype("arial.ttf", 17)
except OSError:
    FONT = SMALL = ImageFont.load_default()


def compose(layers):
    """Oynatıcıdaki gibi: taban = SIL; katmanlar w_k / kümülatif alfa ile sırayla."""
    out = base.copy()
    cum = max(0.0, 1 - sum(l["weight"] for l in layers))
    for l in layers:
        cum += l["weight"]
        sp, dx, dy = sprite(l["sprite"])
        a = sp[..., 3:] / 255 * (l["weight"] / cum)
        h, w = sp.shape[:2]
        out[dy:dy + h, dx:dx + w] = out[dy:dy + h, dx:dx + w] * (1 - a) + sp[..., :3] * a
    return out.astype(np.uint8)


for path in sorted(R.glob("*.json")) if len(sys.argv) < 2 else [R / f"{i}.json" for i in sys.argv[1:]]:
    d = json.loads(path.read_text(encoding="utf-8"))
    head = Image.new("RGB", (N * 2, 64), (20, 20, 20)); dr = ImageDraw.Draw(head)
    dr.text((12, 6), "alignText (istemci tahmini)", font=FONT, fill=(255, 210, 70)); dr.text((N + 12, 6), "Whisper kelime zamanları (referans)", font=FONT, fill=(200, 200, 200))
    dr.text((12, 36), d["text"], font=SMALL, fill=(235, 235, 235))
    head = cv2.cvtColor(np.array(head), cv2.COLOR_RGB2BGR)
    out = R / f"{d['id']}.mp4"
    p = subprocess.Popen([FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{N * 2}x{N + 64}", "-r", str(d["fps"]), "-i", "-",
                          "-i", str(ROOT / "out_v2" / "calib" / d["wav"]), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", str(out)],
                         stdin=subprocess.PIPE)
    for a, b in zip(d["align"], d["reference"]):
        p.stdin.write(np.vstack([head, np.hstack([compose(a), compose(b)])]).tobytes())
    p.stdin.close(); p.wait()
    print("yazıldı", out.name)
