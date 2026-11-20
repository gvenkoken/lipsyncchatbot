"""ADIM 7 – Kalite kontrolleri -> out/quality.json, out/lighting.png
- Alt yüz parlaklık/renk değişimi (Lab) ve kafa pozuyla ilişkisi
- Parça ↔ taban renk uyumu (feather halkasında ΔE)
- Bulanık ve bloklanmış (sıkıştırma) kare oranı
- Diş görünürlüğü (ölçüm; görsel değerlendirme raporda)
"""
import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from common import OUT, load_json, save_json, read_frames, video_info

info = video_info()
W, H, FPS = info["w"], info["h"], info["fps"]
m = pd.read_csv(OUT / "frame_metrics.csv")
idle = load_json(OUT / "idle" / "idle.json")
pj = load_json(OUT / "patches" / "patches.json")
A = np.load(OUT / "align_affine.npy")


def lab_star(lab):   # OpenCV 8-bit Lab -> CIE L*a*b*
    return np.stack([lab[..., 0] * 100 / 255, lab[..., 1] - 128, lab[..., 2] - 128], -1)


L = m.lower_L * 100 / 255
a, b = m.lower_a - 128, m.lower_b - 128
roll = lambda x: x.rolling(int(FPS), center=True, min_periods=1).mean()
q = {}
q["lighting"] = dict(
    L_mean=float(L.mean()), L_std=float(L.std()), L_p05_p95=[float(L.quantile(.05)), float(L.quantile(.95))],
    L_range_1s_smoothed=float(roll(L).max() - roll(L).min()),
    a_std=float(a.std()), b_std=float(b.std()),
    dE_vs_median_p50=float(np.median(np.sqrt((L - L.median()) ** 2 + (a - a.median()) ** 2 + (b - b.median()) ** 2))),
    dE_vs_median_p95=float(np.percentile(np.sqrt((L - L.median()) ** 2 + (a - a.median()) ** 2 + (b - b.median()) ** 2), 95)),
    corr_L_pitch=float(np.corrcoef(L, m.pitch)[0, 1]), corr_L_inner_open=float(np.corrcoef(L, m.inner_open)[0, 1]),
    first10s_vs_last10s_dL=float(L[m.t < 10].mean() - L[m.t > m.t.max() - 10].mean()),
)

# ---- bulanıklık & sıkıştırma ----
sh = m.sharpness
q["sharpness"] = dict(median=float(sh.median()), p05=float(sh.quantile(.05)),
                      blurry_ratio_lt60pct=float((sh < 0.6 * sh.median()).mean()),
                      blurry_ratio_lt40pct=float((sh < 0.4 * sh.median()).mean()),
                      corr_with_jitter=float(np.corrcoef(sh, m.jitter_px)[0, 1]))
bl = m.blockiness.dropna()
q["compression"] = dict(blockiness_median=float(bl.median()), blockiness_p95=float(bl.quantile(.95)),
                        blocky_ratio_gt1_3=float((bl > 1.3).mean()), blocky_ratio_gt1_5=float((bl > 1.5).mean()),
                        note="8px ızgara sınırındaki gradyan / diğer gradyanlar; ~1.0 = blok yok, >1.3 görünür bloklanma")
open_ = m[m.inner_open > 0.04]
q["teeth"] = dict(open_frames=int(len(open_)), teeth_ratio_median_open=float(open_.teeth_ratio.median()),
                  cavity_dark_ratio_median_open=float(open_.cavity_dark_ratio.median()))

# ---- parça ↔ taban renk uyumu ----
idle_imgs = [cv2.imread(str(OUT / "idle" / "frames" / f)) for f in idle["frames"][::5]]
idle_al = [cv2.warpAffine(im, np.array(M), (W, H)) for im, M in zip(idle_imgs, idle["affine_to_ref"][::5])]
idle_lab = np.mean([lab_star(cv2.cvtColor(x, cv2.COLOR_BGR2LAB).astype(np.float32)) for x in idle_al], axis=0)
rows = []
for name, pm in pj["patches"].items():
    p = cv2.imread(str(OUT / "patches" / name), cv2.IMREAD_UNCHANGED)
    alpha = p[..., 3].astype(np.float32) / 255
    plab = lab_star(cv2.cvtColor(p[..., :3], cv2.COLOR_BGR2LAB).astype(np.float32))
    blab = idle_lab[pm["y"]:pm["y"] + pm["h"], pm["x"]:pm["x"] + pm["w"]]
    ring = (alpha > 0.15) & (alpha < 0.85)
    inner = alpha > 0.95
    dE_ring = np.sqrt(((plab[ring].mean(0) - blab[ring].mean(0)) ** 2).sum())
    dL_ring = float(plab[ring, 0].mean() - blab[ring, 0].mean())
    # halkadaki piksel bazlı fark (hizalama hatası + ışık): kenar dikişinin görünürlüğü
    pix_ring = float(np.median(np.sqrt(((plab[ring] - blab[ring]) ** 2).sum(1))))
    rows.append(dict(patch=name, viseme=pm["viseme"], src_frame=pm["src_frame"], dE_ring_mean=round(float(dE_ring), 2),
                     dL_ring=round(dL_ring, 2), dE_ring_pixel_median=round(pix_ring, 2)))
pc = pd.DataFrame(rows)
pc.to_csv(OUT / "patch_color_match.csv", index=False)
q["patch_match"] = dict(dE_ring_mean_median=float(pc.dE_ring_mean.median()), dE_ring_mean_max=float(pc.dE_ring_mean.max()),
                        dE_ring_pixel_median=float(pc.dE_ring_pixel_median.median()),
                        worst=pc.sort_values("dE_ring_mean", ascending=False).head(5).to_dict("records"),
                        note="ΔE<2 fark edilmez, 2–5 dikkatli bakınca, >5 belirgin")
save_json(q, OUT / "quality.json")
for k, v in q.items():
    print(k, {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items() if kk != "worst"})
print(pc.to_string(index=False))

# ---- grafik ----
fig, axs = plt.subplots(3, 1, figsize=(13, 7), sharex=True)
axs[0].plot(m.t, L, color="#86b6ef", lw=0.6, label="alt yüz L* (kare)")
axs[0].plot(m.t, roll(L), color="#2a78d6", lw=1.5, label="1 s ortalama")
axs[0].set_ylabel("L*"); axs[0].legend(frameon=False, fontsize=8, loc="upper right")
axs[0].set_title("Alt yüz ışık/renk tutarlılığı ve keskinlik", loc="left", fontsize=11)
axs[1].plot(m.t, a, color="#eb6834", lw=0.8, label="a* (kırmızı-yeşil)")
axs[1].plot(m.t, b, color="#1baf7a", lw=0.8, label="b* (sarı-mavi)")
axs[1].set_ylabel("renk"); axs[1].legend(frameon=False, fontsize=8, loc="upper right", ncol=2)
axs[2].plot(m.t, sh, color="#2a78d6", lw=0.6)
axs[2].axhline(0.6 * sh.median(), color="#52514e", ls="--", lw=0.8)
axs[2].text(m.t.max(), 0.6 * sh.median(), "  bulanık eşiği (%60 medyan)", fontsize=8, va="bottom", ha="right")
axs[2].set_ylabel("ağız keskinliği\n(Laplacian var.)"); axs[2].set_xlabel("zaman (s)")
for ax in axs:
    ax.grid(alpha=.25, lw=.5); ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout(); fig.savefig(OUT / "lighting.png", dpi=110)
