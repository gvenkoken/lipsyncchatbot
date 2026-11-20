"""ADIM 2 – MediaPipe Face Landmarker: her kare için landmark, blendshape, poz.
Çıktılar:
  out/landmarks.npz      (lm: N×478×3 piksel, found: N, blend: N×52, pose: N×3 yaw/pitch/roll)
  out/stability.csv      (kare bazlı kayma, ölçek, poz, hizalama sonrası hata)
  out/stability.json     (özet)
  out/head_stability.png (zaman grafiği)
  out/reference_frame.png
"""
import math
import time

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mediapipe as mp
import numpy as np
import pandas as pd
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

from common import (OUT, MODELS, STABLE, NOSE_TIP, EYE_R_OUT, EYE_L_OUT, EYE_R_IN, EYE_L_IN,
                    LIP_UP_IN, LIP_LO_IN, FOREHEAD, CHIN, iter_frames, video_info, save_json, read_frames)

info = video_info()
N, FPS, W, H = info["n"], info["fps"], info["w"], info["h"]

npz_path = OUT / "landmarks.npz"
if not npz_path.exists():
    opts = vision.FaceLandmarkerOptions(
        base_options=mpt.BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=1,
        output_face_blendshapes=True, output_facial_transformation_matrixes=True,
        min_face_detection_confidence=0.5, min_tracking_confidence=0.5)
    lm = np.full((N, 478, 3), np.nan, np.float32)
    blend = np.full((N, 52), np.nan, np.float32)
    mats = np.full((N, 4, 4), np.nan, np.float32)
    names = None
    t0 = time.time()
    with vision.FaceLandmarker.create_from_options(opts) as det:
        for i, fr in iter_frames():
            if i >= N:
                break
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
            res = det.detect_for_video(img, int(round(i * 1000 / FPS)))
            if res.face_landmarks:
                pts = res.face_landmarks[0]
                lm[i] = np.array([[p.x * W, p.y * H, p.z * W] for p in pts], np.float32)
                bs = res.face_blendshapes[0]
                blend[i] = [b.score for b in bs]
                names = names or [b.category_name for b in bs]
                mats[i] = np.array(res.facial_transformation_matrixes[0])
            if i % 500 == 0:
                print(f"  kare {i}/{N}  {time.time()-t0:.0f}s")
    np.savez_compressed(npz_path, lm=lm, blend=blend, mats=mats, names=np.array(names))
d = np.load(npz_path)
lm, blend, mats, names = d["lm"], d["blend"], d["mats"], list(d["names"])
found = ~np.isnan(lm[:, 0, 0])
print(f"Yüz bulunamayan kare: {(~found).sum()} / {N} ({(~found).mean()*100:.2f}%)")


def euler(R):
    yaw = math.degrees(math.asin(max(-1, min(1, -R[2, 0]))))
    pitch = math.degrees(math.atan2(R[2, 1], R[2, 2]))
    roll = math.degrees(math.atan2(R[1, 0], R[0, 0]))
    return yaw, pitch, roll


pose = np.array([euler(m[:3, :3]) if f else (np.nan,) * 3 for m, f in zip(mats, found)])
bi = {n: k for k, n in enumerate(names)}
blink = np.nanmean(blend[:, [bi["eyeBlinkLeft"], bi["eyeBlinkRight"]]], axis=1)
face_h = np.linalg.norm(lm[:, FOREHEAD, :2] - lm[:, CHIN, :2], axis=1)
inner_open = np.linalg.norm(lm[:, LIP_UP_IN, :2] - lm[:, LIP_LO_IN, :2], axis=1) / face_h

# --- ham kafa kayması (burun ucu + göz köşeleri) ---
keypts = [NOSE_TIP, EYE_R_OUT, EYE_R_IN, EYE_L_IN, EYE_L_OUT]
kp = lm[:, keypts, :2]
med = np.nanmedian(kp, axis=0)
drift = np.linalg.norm(kp - med, axis=2)                 # N×5
drift_mean = np.nanmean(drift, axis=1)
iod = np.linalg.norm(lm[:, EYE_R_OUT, :2] - lm[:, EYE_L_OUT, :2], axis=1)
scale = iod / np.nanmedian(iod)
jitter = np.r_[0, np.nanmean(np.linalg.norm(np.diff(kp, axis=0), axis=2), axis=1)]  # kareden kareye

# --- referans kare: ağız kapalı, göz açık, medyan poza en yakın ---
S = lm[:, STABLE, :2]
Smed = np.nanmedian(S, axis=0)
shape_dist = np.nanmean(np.linalg.norm(S - Smed, axis=2), axis=1)
pose_med = np.nanmedian(pose, axis=0)
pose_dist = np.linalg.norm(pose - pose_med, axis=1)
score = shape_dist + 2.0 * pose_dist + 400 * np.clip(inner_open - 0.005, 0, None) + 30 * np.clip(blink - 0.3, 0, None)
score[~found] = np.inf
ref = int(np.nanargmin(score))
print(f"Referans kare: {ref} (t={ref/FPS:.2f}s) şekil-medyan farkı {shape_dist[ref]:.2f}px")

# --- benzerlik (partial affine) hizalaması: kare -> referans ---
A = np.full((N, 2, 3), np.nan, np.float32)
resid = np.full(N, np.nan)
resid_lower = np.full(N, np.nan)
LOWER_RIGID = [2, 98, 327, 234, 454]  # burun altı + yanak dış kenarı (dikiş bölgesi)
dst = lm[ref, STABLE, :2]
for i in np.where(found)[0]:
    M, _ = cv2.estimateAffinePartial2D(lm[i, STABLE, :2], dst, method=cv2.LMEDS)
    if M is None:
        continue
    A[i] = M
    p = lm[i, STABLE, :2] @ M[:, :2].T + M[:, 2]
    resid[i] = np.sqrt(np.mean(np.sum((p - dst) ** 2, axis=1)))
    q = lm[i, LOWER_RIGID, :2] @ M[:, :2].T + M[:, 2]
    resid_lower[i] = np.sqrt(np.mean(np.sum((q - lm[ref, LOWER_RIGID, :2]) ** 2, axis=1)))
tx, ty = A[:, 0, 2], A[:, 1, 2]
a_scale = np.sqrt(A[:, 0, 0] ** 2 + A[:, 1, 0] ** 2)
a_rot = np.degrees(np.arctan2(A[:, 1, 0], A[:, 0, 0]))

df = pd.DataFrame(dict(frame=np.arange(N), t=np.arange(N) / FPS, found=found,
                       nose_x=lm[:, NOSE_TIP, 0], nose_y=lm[:, NOSE_TIP, 1],
                       drift_px=drift_mean, nose_drift_px=drift[:, 0], jitter_px=jitter, scale=scale,
                       yaw=pose[:, 0], pitch=pose[:, 1], roll=pose[:, 2], blink=blink, inner_open=inner_open,
                       align_resid_px=resid, align_resid_lower_px=resid_lower,
                       align_tx=tx, align_ty=ty, align_scale=a_scale, align_rot_deg=a_rot))
df.to_csv(OUT / "stability.csv", index=False)
np.save(OUT / "align_affine.npy", A)


def stats(x):
    x = x[~np.isnan(x)]
    return dict(mean=float(np.mean(x)), median=float(np.median(x)), p95=float(np.percentile(x, 95)),
                max=float(np.max(x)), std=float(np.std(x)))


summary = dict(
    n_frames=N, missing_frames=int((~found).sum()), missing_ratio=float((~found).mean()),
    reference_frame=ref, reference_time_s=ref / FPS,
    face_height_px=float(np.nanmedian(face_h)), interocular_px=float(np.nanmedian(iod)),
    keypoint_drift_px=stats(drift_mean), nose_drift_px=stats(drift[:, 0]),
    nose_range_px=dict(x=float(np.nanmax(kp[:, 0, 0]) - np.nanmin(kp[:, 0, 0])),
                       y=float(np.nanmax(kp[:, 0, 1]) - np.nanmin(kp[:, 0, 1]))),
    frame_to_frame_jitter_px=stats(jitter[1:]),
    scale=dict(min=float(np.nanmin(scale)), max=float(np.nanmax(scale)), std=float(np.nanstd(scale))),
    yaw_deg=stats(pose[:, 0] - pose_med[0]), pitch_deg=stats(pose[:, 1] - pose_med[1]),
    roll_deg=stats(pose[:, 2] - pose_med[2]),
    yaw_abs_dev=stats(np.abs(pose[:, 0] - pose_med[0])), pitch_abs_dev=stats(np.abs(pose[:, 1] - pose_med[1])),
    roll_abs_dev=stats(np.abs(pose[:, 2] - pose_med[2])),
    pose_median_deg=dict(yaw=float(pose_med[0]), pitch=float(pose_med[1]), roll=float(pose_med[2])),
    align_resid_px=stats(resid), align_resid_lower_px=stats(resid_lower),
)
save_json(summary, OUT / "stability.json")
for k in ["keypoint_drift_px", "nose_drift_px", "frame_to_frame_jitter_px", "yaw_abs_dev", "pitch_abs_dev",
          "roll_abs_dev", "align_resid_px", "align_resid_lower_px"]:
    s = summary[k]
    print(f"{k:26s} ort {s['mean']:.2f}  p95 {s['p95']:.2f}  max {s['max']:.2f}")
print("ölçek", summary["scale"])

# referans kareyi kaydet
cv2.imwrite(str(OUT / "reference_frame.png"), read_frames([ref])[ref])

# --- grafik ---
C1, C2, C3 = "#2a78d6", "#eb6834", "#1baf7a"
fig, axs = plt.subplots(4, 1, figsize=(13, 10), sharex=True)
t = df.t
axs[0].plot(t, drift_mean, color=C1, lw=1, label="Ham kayma (burun+göz köşeleri, medyana uzaklık)")
axs[0].plot(t, resid, color=C2, lw=1, label="Hizalama sonrası kalan hata (rijit noktalar RMS)")
axs[0].set_ylabel("piksel"); axs[0].legend(loc="upper right", fontsize=8, frameon=False)
axs[0].set_title("Kafa sabitliği — 1080×1080 kare", loc="left", fontsize=11)
axs[1].plot(t, (scale - 1) * 100, color=C1, lw=1)
axs[1].set_ylabel("ölçek değişimi %")
axs[2].plot(t, pose[:, 0] - pose_med[0], color=C1, lw=1, label="yaw")
axs[2].plot(t, pose[:, 1] - pose_med[1], color=C2, lw=1, label="pitch")
axs[2].plot(t, pose[:, 2] - pose_med[2], color=C3, lw=1, label="roll")
axs[2].set_ylabel("açı (medyana göre, °)"); axs[2].legend(loc="upper right", fontsize=8, frameon=False, ncol=3)
axs[3].plot(t, inner_open * 100, color=C1, lw=0.8, label="iç dudak açıklığı (% yüz yüksekliği)")
axs[3].plot(t, blink * 10, color=C2, lw=0.8, label="göz kırpma skoru ×10")
axs[3].set_ylabel("ağız / göz"); axs[3].set_xlabel("zaman (s)")
axs[3].legend(loc="upper right", fontsize=8, frameon=False)
for ax in axs:
    ax.grid(alpha=0.25, lw=0.5); ax.spines[["top", "right"]].set_visible(False)
    ax.axvline(ref / FPS, color="#52514e", lw=0.6, ls="--")
fig.tight_layout()
fig.savefig(OUT / "head_stability.png", dpi=110)
print("Kaydedildi: head_stability.png")
