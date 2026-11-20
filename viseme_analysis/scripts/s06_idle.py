"""ADIM 6 – Boşta (idle) taban döngüsü.
İki aday aranır:
  strict : ağız kapalı + kafa sabit + (tercihen) göz kırpma içeren 2–5 s
  relaxed: ağız durumu önemsiz (alt yüze her zaman SIL parçası bindirilir), kafa sabit + göz kırpma
Çıktılar: out/idle/idle_loop.mp4, out/idle/frames/idle_XXX.jpg, out/idle/idle.json
"""
import shutil

import cv2
import numpy as np
import pandas as pd

from common import OUT, FFMPEG, STABLE, read_frames, run, save_json, video_info

info = video_info()
N, FPS, W, H = info["n"], info["fps"], info["w"], info["h"]
m = pd.read_csv(OUT / "frame_metrics.csv")
d = np.load(OUT / "landmarks.npz")
lm = d["lm"]
A = np.load(OUT / "align_affine.npy")

closed_thr = 0.012                                # iç dudak açıklığı / yüz yüksekliği
closed = (m.inner_open < closed_thr).values
silent = (m.viseme == "SIL").values
blink = m.blink.values
eye_c = lm[:, [33, 133, 362, 263], :2].mean(1)    # göz merkezi: kafa hareketinin iyi bir vekili
S = lm[:, STABLE, :2]


def window_score(s, L, need_closed):
    e = s + L
    if need_closed and closed[s:e].mean() < 0.97:
        return None
    ec = eye_c[s:e]
    motion = np.sqrt(((ec - ec.mean(0)) ** 2).sum(1)).max()          # pencere içi max kayma (px)
    jit = np.percentile(np.linalg.norm(np.diff(ec, axis=0), axis=1), 95)
    seam = np.sqrt(((S[e - 1] - S[s]) ** 2).sum(1).mean())             # döngü dikişi: son vs ilk kare
    b = blink[s:e]
    # tam kırpma: >0.5'e çıkıp tekrar <0.3'e dönen ve pencere kenarlarına yapışmayan
    has_blink = bool((b[3:-3] > 0.5).any() and b[:3].max() < 0.35 and b[-3:].max() < 0.35) if L > 10 else False
    sil_frac = silent[s:e].mean()
    score = motion * 1.0 + jit * 2.0 + seam * 1.5 - (6 if has_blink else 0) - L / FPS * 1.5 - sil_frac * 3
    return dict(start=s, length=L, motion_px=motion, jitter_p95=jit, seam_px=seam, has_blink=has_blink,
                closed_frac=float(closed[s:e].mean()), silent_frac=float(sil_frac), score=score)


results = {}
for mode, need_closed in [("strict", True), ("relaxed", False)]:
    best = None
    for L in range(int(2 * FPS), int(5 * FPS) + 1, 5):
        for s in range(0, N - L, 2):
            r = window_score(s, L, need_closed)
            if r and (best is None or r["score"] < best["score"]):
                best = r
    results[mode] = best
    print(mode, best)

# en uzun kapalı-ağız aralığı (bilgi amaçlı)
runs, cur = [], 0
for c in closed:
    cur = cur + 1 if c else 0
    runs.append(cur)
print(f"En uzun kesintisiz kapalı ağız: {max(runs)/FPS:.2f}s")

# strict uygun bulunamazsa veya çok kısa/oynaksa relaxed kullan
chosen_mode = "strict" if results["strict"] and results["strict"]["motion_px"] < 8 else "relaxed"
ch = results[chosen_mode]
s, L = ch["start"], ch["length"]
idx = list(range(s, s + L))
frames = read_frames(idx)

idle_dir = OUT / "idle"
fdir = idle_dir / "frames"
if fdir.exists():
    shutil.rmtree(fdir)
fdir.mkdir(parents=True)
for k, i in enumerate(idx):
    cv2.imwrite(str(fdir / f"idle_{k:03d}.jpg"), frames[i], [cv2.IMWRITE_JPEG_QUALITY, 93])
run([FFMPEG, "-v", "error", "-y", "-framerate", str(FPS), "-i", str(fdir / "idle_%03d.jpg"),
     "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(idle_dir / "idle_loop.mp4")])

# döngü sıçraması: son->ilk kare farkı, tipik ardışık kare farkına göre
f = [frames[i].astype(np.float32) for i in idx]
consec = [np.abs(f[k + 1] - f[k]).mean() for k in range(L - 1)]
loop_jump = np.abs(f[0] - f[-1]).mean()
lm_jump = float(np.linalg.norm(eye_c[idx[-1]] - eye_c[idx[0]]))
consec_lm = np.linalg.norm(np.diff(eye_c[idx], axis=0), axis=1)
# ping-pong alternatifinde dikiş yoktur (ileri-geri oynatma) ama hareket yönü tersine döner
out = dict(mode=chosen_mode, candidates=results, start_frame=s, end_frame=s + L - 1, length=L,
           start_s=s / FPS, duration_s=L / FPS, frames=[f"idle_{k:03d}.jpg" for k in range(L)],
           source_frames=idx,
           loop_jump_pixel_mae=float(loop_jump), consecutive_pixel_mae_median=float(np.median(consec)),
           consecutive_pixel_mae_max=float(np.max(consec)),
           loop_jump_eye_px=lm_jump, consecutive_eye_px_median=float(np.median(consec_lm)),
           consecutive_eye_px_max=float(consec_lm.max()),
           longest_closed_run_s=max(runs) / FPS,
           # her idle karesi için kare->referans affine (patch'ler referans koordinatında; tarayıcıda
           # parça çizilirken bunun TERSİ uygulanır)
           affine_to_ref=[A[i].round(6).tolist() for i in idx],
           affine_from_ref=[cv2.invertAffineTransform(A[i]).round(6).tolist() for i in idx])
save_json(out, idle_dir / "idle.json")
print(f"Seçilen: {chosen_mode}  kare {s}-{s+L-1} ({s/FPS:.2f}-{(s+L)/FPS:.2f}s, {L/FPS:.2f}s) "
      f"blink={ch['has_blink']}")
print(f"Döngü sıçraması: piksel MAE {loop_jump:.2f} (ardışık medyan {np.median(consec):.2f}, max {np.max(consec):.2f}); "
      f"göz merkezi {lm_jump:.2f}px (ardışık medyan {np.median(consec_lm):.2f}, max {consec_lm.max():.2f})")

# ---- ping-pong sürümü (ileri + geri): dikiş sıçraması olmaz ----
pp = list(range(L)) + list(range(L - 2, 0, -1))
run([FFMPEG, "-v", "error", "-y", "-framerate", str(FPS), "-i", str(fdir / "idle_%03d.jpg"),
     "-vf", "split[a][b];[b]reverse,trim=start_frame=1:end_frame=" + str(L - 1) + ",setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1",
     "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(idle_dir / "idle_loop_pingpong.mp4")])

# ---- bilgi: göz kırpması İÇEREN en iyi sabit pencere (ağız durumu serbest; SIL parçası bindirilir) ----
best_blink = None
for Lb in range(int(2 * FPS), int(5 * FPS) + 1, 5):
    for s0 in range(0, N - Lb, 2):
        r = window_score(s0, Lb, False)
        if r and r["has_blink"] and r["motion_px"] < 8 and (best_blink is None or r["score"] < best_blink["score"]):
            best_blink = r
print("Göz kırpmalı en iyi pencere:", best_blink)
out["playback_order_pingpong"] = pp
out["recommended_playback"] = "pingpong"
out["best_blink_window"] = best_blink
save_json(out, idle_dir / "idle.json")
