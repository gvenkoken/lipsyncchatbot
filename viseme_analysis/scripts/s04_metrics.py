"""ADIM 4 – Kare bazlı ağız ölçümleri + viseme etiketleri -> out/frame_metrics.csv
Ayrıca Adım 7 için alt yüz parlaklık/renk, keskinlik ve sıkıştırma (bloklanma) ölçülerini de toplar.
"""
import cv2
import numpy as np
import pandas as pd

from common import (OUT, NOSE_TIP, FOREHEAD, CHIN, EYE_R_OUT, EYE_L_OUT, LIP_L, LIP_R, LIP_UP_OUT, LIP_LO_OUT,
                    LIP_UP_IN, LIP_LO_IN, INNER_LIP, OUTER_LIP, JAW_LINE, UPPER_BOUND, iter_frames, video_info, load_json)

info = video_info()
N, FPS = info["n"], info["fps"]
d = np.load(OUT / "landmarks.npz")
lm, blend, names = d["lm"], d["blend"], list(d["names"])
A = np.load(OUT / "align_affine.npy")
stab = pd.read_csv(OUT / "stability.csv")
ref = load_json(OUT / "stability.json")["reference_frame"]
vis = pd.read_csv(OUT / "visemes.csv")


def dist(i, j):
    return np.linalg.norm(lm[:, i, :2] - lm[:, j, :2], axis=1)


face_h = dist(FOREHEAD, CHIN)
iod = dist(EYE_R_OUT, EYE_L_OUT)
upper_face = dist(FOREHEAD, NOSE_TIP)                     # çene hareketinden bağımsız ölçek
m = pd.DataFrame(dict(frame=np.arange(N), t=(np.arange(N) + 0.5) / FPS))
m["inner_open"] = dist(LIP_UP_IN, LIP_LO_IN) / face_h      # iç dudak açıklığı / yüz yüksekliği
m["outer_open"] = dist(LIP_UP_OUT, LIP_LO_OUT) / face_h
m["mouth_width"] = dist(LIP_L, LIP_R) / iod                # ağız genişliği / göz dış köşe mesafesi
m["roundness"] = dist(LIP_L, LIP_R) / np.maximum(dist(LIP_UP_OUT, LIP_LO_OUT), 1e-3)  # genişlik/yükseklik
m["jaw_open"] = dist(NOSE_TIP, CHIN) / upper_face          # çene açıklığı
bi = {n: k for k, n in enumerate(names)}
for b in ["jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthSmileLeft", "mouthStretchLeft",
          "mouthRollLower", "mouthRollUpper", "mouthUpperUpLeft", "mouthLowerDownLeft"]:
    m["bs_" + b] = blend[:, bi[b]]
for c in ["found", "blink", "drift_px", "nose_drift_px", "jitter_px", "scale", "yaw", "pitch", "roll",
          "align_resid_px", "align_resid_lower_px"]:
    m[c] = stab[c].values

# ---- viseme etiketi (kare ortası zamanı) ----
starts, ends = vis.start.values, vis.end.values
seg = np.clip(np.searchsorted(starts, m.t.values, side="right") - 1, 0, len(vis) - 1)
m["viseme"] = vis.viseme.values[seg]
m["coart_vowel"] = vis.coart_vowel.fillna("").values[seg]
m["seg_id"] = seg
m["seg_dur"] = (ends - starts)[seg]
m["seg_relpos"] = ((m.t.values - starts[seg]) / np.maximum(ends - starts, 1e-6)[seg]).clip(0, 1)

# ---- görüntü tabanlı ölçümler (referansa hizalanmış alt yüz) ----
ref_lm = lm[ref, :, :2]
lower_poly = np.vstack([ref_lm[JAW_LINE], ref_lm[UPPER_BOUND[1:-1]][::-1]]).astype(np.int32)
H, W = info["h"], info["w"]
lower_mask = np.zeros((H, W), np.uint8)
cv2.fillPoly(lower_mask, [lower_poly], 255)
lower_mask = cv2.erode(lower_mask, np.ones((15, 15), np.uint8))
bx, by, bw, bh = cv2.boundingRect(ref_lm[OUTER_LIP].astype(np.float32))
pad = int(0.25 * bw)
mouth_roi = (max(0, bx - pad), max(0, by - pad), min(W, bx + bw + pad), min(H, by + bh + pad))

L_, a_, b_, sharp, block, teeth, dark = (np.full(N, np.nan) for _ in range(7))
for i, fr in iter_frames():
    if i >= N:
        break
    if np.isnan(A[i, 0, 0]):
        continue
    al = cv2.warpAffine(fr, A[i], (W, H), flags=cv2.INTER_LINEAR)
    lab = cv2.cvtColor(al, cv2.COLOR_BGR2LAB)
    mm = lower_mask > 0
    L_[i], a_[i], b_[i] = [lab[..., k][mm].mean() for k in range(3)]
    rx0, ry0, rx1, ry1 = mouth_roi
    g = cv2.cvtColor(al[ry0:ry1, rx0:rx1], cv2.COLOR_BGR2GRAY)
    sharp[i] = cv2.Laplacian(g, cv2.CV_64F).var()
    # bloklanma: orijinal (hizasız) karede ağız bölgesinde 8 px ızgara sınırlarındaki sıçrama oranı
    p = lm[i, OUTER_LIP, :2]
    ox0, oy0 = (np.floor(p.min(0) / 8) * 8 - 16).astype(int)
    ox1, oy1 = (np.ceil(p.max(0) / 8) * 8 + 16).astype(int)
    go = cv2.cvtColor(fr[max(0, oy0):oy1, max(0, ox0):ox1], cv2.COLOR_BGR2GRAY).astype(np.float32)
    dx = np.abs(np.diff(go, axis=1))
    cols = (np.arange(dx.shape[1]) + max(0, ox0)) % 8 == 7
    if cols.any() and (~cols).any():
        block[i] = dx[:, cols].mean() / (dx[:, ~cols].mean() + 1e-6)
    # iç dudak poligonu içinde diş (açık, düşük doygunluk) ve ağız boşluğu (koyu) oranı
    ip = lm[i, INNER_LIP, :2].astype(np.int32)
    pm = np.zeros(fr.shape[:2], np.uint8)
    cv2.fillPoly(pm, [ip], 255)
    if pm.sum() > 255 * 20:
        hsv = cv2.cvtColor(fr, cv2.COLOR_BGR2HSV)[pm > 0]
        teeth[i] = np.mean((hsv[:, 2] > 150) & (hsv[:, 1] < 90))
        dark[i] = np.mean(hsv[:, 2] < 60)
    else:
        teeth[i] = dark[i] = 0
    if i % 1000 == 0:
        print(f"  kare {i}/{N}")
m["lower_L"], m["lower_a"], m["lower_b"] = L_, a_, b_
m["sharpness"] = sharp
m["blockiness"] = block
m["teeth_ratio"] = teeth
m["cavity_dark_ratio"] = dark
m.to_csv(OUT / "frame_metrics.csv", index=False, float_format="%.5f")
print("Kaydedildi: frame_metrics.csv", m.shape)
print(m.groupby("viseme")[["inner_open", "mouth_width", "roundness", "jaw_open"]].median().round(3).to_string())
