"""Ortak yardımcılar: yollar, ffmpeg bulma, kare okuma, landmark indeksleri."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]          # ./viseme_analysis
VIDEO = ROOT.parent / "inputs" / "reference.mp4"     # orijinal (salt okunur)
OUT = ROOT / "out"
MODELS = ROOT / "models"
OUT.mkdir(exist_ok=True)


def find_tool(name: str) -> str:
    """ffmpeg/ffprobe yolunu bul: PATH, FFMPEG_BIN ortam değişkeni, winget Gyan.FFmpeg konumu."""
    p = shutil.which(name)
    if p:
        return p
    env = os.environ.get("FFMPEG_BIN")
    if env and (Path(env) / f"{name}.exe").exists():
        return str(Path(env) / f"{name}.exe")
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for hit in base.glob(f"Gyan.FFmpeg*/**/bin/{name}.exe"):
        return str(hit)
    raise FileNotFoundError(
        f"{name} bulunamadı. Kurulum: winget install --id Gyan.FFmpeg --scope user "
        f"(veya FFMPEG_BIN ortam değişkenine bin klasörünü verin)")


FFMPEG = find_tool("ffmpeg")
FFPROBE = find_tool("ffprobe")


def run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"Komut başarısız: {' '.join(cmd)}\n{r.stderr[-2000:]}")
    return r.stdout


def video_info() -> dict:
    cap = cv2.VideoCapture(str(VIDEO))
    info = dict(fps=cap.get(cv2.CAP_PROP_FPS), n=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
                w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    cap.release()
    return info


def iter_frames(start: int = 0, end: int | None = None):
    cap = cv2.VideoCapture(str(VIDEO))
    if start:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    i = start
    while True:
        if end is not None and i >= end:
            break
        ok, fr = cap.read()
        if not ok:
            break
        yield i, fr
        i += 1
    cap.release()


def read_frames(indices) -> dict[int, np.ndarray]:
    """İstenen kareleri sıralı okuyarak getir (seek hatalarından kaçınmak için)."""
    want = set(int(i) for i in indices)
    out = {}
    if not want:
        return out
    hi = max(want)
    for i, fr in iter_frames(0, hi + 1):
        if i in want:
            out[i] = fr
    return out


def save_json(obj, path: Path):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=float), encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---- MediaPipe 478 landmark indeksleri ----
NOSE_TIP = 1
EYE_R_OUT, EYE_R_IN, EYE_L_IN, EYE_L_OUT = 33, 133, 362, 263
FOREHEAD, CHIN = 10, 152
LIP_L, LIP_R = 61, 291                # dış dudak köşeleri
LIP_UP_OUT, LIP_LO_OUT = 0, 17
LIP_UP_IN, LIP_LO_IN = 13, 14
INNER_LIP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
OUTER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
# Hizalama için ağız/çene hareketinden etkilenmeyen "rijit" noktalar
STABLE = [33, 133, 362, 263, 168, 6, 197, 195, 5, 9, 151, 10, 127, 356, 234, 454, 46, 276, 98, 327]
# Alt yüz maskesi: çene hattı + burun altı / yanak üst sınırı
JAW_LINE = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454]
UPPER_BOUND = [454, 352, 411, 425, 423, 327, 2, 98, 203, 205, 187, 123, 234]

VISEMES = ["SIL", "PBM", "FV", "DNT", "SZ", "SH", "KG", "A", "E", "I", "O", "U"]
