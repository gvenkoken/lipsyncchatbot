"""ADIM 5 – Her viseme için kapsama, tutarlılık, en temsilî 3 kare, kontak tabakaları ve alt yüz parçaları.
Çıktılar:
  out/viseme_coverage.csv, out/selected_frames.csv
  out/contact_<VISEME>.png, out/contact_all.png
  out/patches/<VISEME>_<n>.png  (RGBA, referans koordinatlarında, feathered alpha)
  out/patches/patches.json      (her parçanın referans karedeki ofseti)
"""
import cv2
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

from common import OUT, VISEMES, JAW_LINE, UPPER_BOUND, OUTER_LIP, NOSE_TIP, CHIN, read_frames, load_json, save_json, video_info

info = video_info()
W, H, FPS = info["w"], info["h"], info["fps"]
m = pd.read_csv(OUT / "frame_metrics.csv")
words = pd.read_csv(OUT / "letters.csv")
d = np.load(OUT / "landmarks.npz")
lm = d["lm"]
A = np.load(OUT / "align_affine.npy")
ref = load_json(OUT / "stability.json")["reference_frame"]
FEATS = ["inner_open", "mouth_width", "roundness", "jaw_open"]
PATCH_DIR = OUT / "patches"
PATCH_DIR.mkdir(exist_ok=True)

ok = m.found & m.sharpness.notna()
g = m[ok]
robust_sd = {f: 1.4826 * np.median(np.abs(g[f] - g[f].median())) + 1e-9 for f in FEATS}
sharp_med = g.sharpness.median()


def word_at(t):
    w = words[(words.start <= t) & (words.end >= t)]
    return w.iloc[0].word if len(w) else ""


cov_rows, sel_rows = [], []
for v in VISEMES:
    gv = gv_all = g[g.viseme == v]
    if gv.empty:
        cov_rows.append(dict(viseme=v, frames=0, passages=0)); continue
    # Güvenilir adaylar: harf zamanlaması kaba olduğundan segment ortası ve yeterince uzun segmentler
    if v == "SIL":
        # tanım gereği ağız kapalı: duraklamalarda ağız aralık kalabildiği için açıkça filtrele
        rel = gv[(gv.seg_dur >= 0.4) & (gv.inner_open < 0.012)]
    elif v in ("PBM",):
        rel = gv                                         # s03b'de görüntüye oturtuldu
    elif v in ("A", "E", "I", "O", "U"):
        rel = gv[(gv.seg_dur >= 0.08) & gv.seg_relpos.between(0.15, 0.85)]
    else:
        rel = gv[gv.seg_relpos.between(0.1, 0.9)]
    if len(rel) >= 10:
        gv = rel
    med = gv[FEATS].median()
    iqr = (gv[FEATS].quantile(0.75) - gv[FEATS].quantile(0.25))
    # tutarlılık: viseme içi yayılım / tüm video yayılımı (1'e yakın = ayırt edici değil)
    disp = float(np.mean([(gv[f].quantile(.75) - gv[f].quantile(.25)) /
                          (g[f].quantile(.75) - g[f].quantile(.25) + 1e-9) for f in FEATS]))
    cov_rows.append(dict(viseme=v, frames=len(gv_all), passages=gv_all.seg_id.nunique(), reliable_frames=len(gv),
                         total_s=round(len(gv_all) / FPS, 2), dispersion=round(disp, 3),
                         **{f"med_{f}": round(med[f], 4) for f in FEATS},
                         **{f"iqr_{f}": round(iqr[f], 4) for f in FEATS},
                         sharp_med=round(gv.sharpness.median(), 1), blink_ratio=round((gv.blink > 0.4).mean(), 3)))
    # --- puanlama: medyana yakınlık + keskinlik + göz açık + kafa referansa yakın + segment ortası ---
    z = np.sqrt(sum(((gv[f] - med[f]) / robust_sd[f]) ** 2 for f in FEATS))
    sharp_pen = np.clip(1 - gv.sharpness / sharp_med, 0, None) * 2.0
    blink_pen = np.where(gv.blink > 0.35, 5.0, gv.blink * 2)
    head_pen = gv.align_resid_px / 2.0 + (gv.scale - 1).abs() * 20 + gv.drift_px / 15
    centre_pen = np.where(gv.seg_dur > 0.1, np.abs(gv.seg_relpos - 0.5), 0.3)
    score = z + sharp_pen + blink_pen + head_pen + centre_pen
    order = gv.assign(score=score).sort_values("score")
    picked, segs = [], set()
    for r in order.itertuples():          # her biri farklı geçişten (seg_id) gelsin
        if r.seg_id in segs:
            continue
        picked.append(r); segs.add(r.seg_id)
        if len(picked) == 3:
            break
    for n, r in enumerate(picked, 1):
        sel_rows.append(dict(viseme=v, n=n, frame=int(r.frame), t=round(r.t, 3), score=round(r.score, 3),
                             word=word_at(r.t), **{f: round(getattr(r, f), 4) for f in FEATS},
                             sharpness=round(r.sharpness, 1), blink=round(r.blink, 3),
                             align_resid_px=round(r.align_resid_px, 2), teeth_ratio=round(r.teeth_ratio, 3)))
cov = pd.DataFrame(cov_rows)
sel = pd.DataFrame(sel_rows)
cov.to_csv(OUT / "viseme_coverage.csv", index=False)
sel.to_csv(OUT / "selected_frames.csv", index=False)
print(cov[["viseme", "frames", "passages", "total_s", "dispersion", "med_inner_open", "med_mouth_width",
           "med_roundness", "med_jaw_open"]].to_string(index=False))

# ---------------- görseller ----------------
frames = read_frames(sel.frame.tolist() + [ref])
ref_lm = lm[ref, :, :2]


def aligned(i):
    return cv2.warpAffine(frames[i], A[i], (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def aligned_lm(i):
    return lm[i, :, :2] @ A[i][:, :2].T + A[i][:, 2]


# kırpma kutusu: burun ucunun biraz üstünden çene altına
jx = ref_lm[JAW_LINE, 0]
cx0, cx1 = int(jx.min() - 20), int(jx.max() + 20)
cy0, cy1 = int(ref_lm[NOSE_TIP, 1] - 60), int(ref_lm[CHIN, 1] + 70)
# ağız yakın planı (contact_all için)
ob = ref_lm[OUTER_LIP]
mcx, mcy = ob.mean(0)
mw = (ob[:, 0].max() - ob[:, 0].min()) * 1.9
mx0, mx1 = int(mcx - mw / 2), int(mcx + mw / 2)
my0, my1 = int(mcy - mw * 0.42), int(mcy + mw * 0.48)

try:
    FONT = ImageFont.truetype("arial.ttf", 18); FONT_B = ImageFont.truetype("arialbd.ttf", 26)
except OSError:
    FONT = FONT_B = ImageFont.load_default()


def label(img_bgr, lines, big=None):
    im = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    dr = ImageDraw.Draw(im)
    y = 6
    if big:
        dr.text((8, y), big, font=FONT_B, fill=(255, 220, 60)); y += 32
    for ln in lines:
        dr.text((8, y), ln, font=FONT, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0)); y += 22
    return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)


rows_all = []
for v in VISEMES:
    sv = sel[sel.viseme == v]
    tiles, mtiles = [], []
    for r in sv.itertuples():
        al = aligned(r.frame)
        crop = al[cy0:cy1, cx0:cx1].copy()
        tiles.append(label(crop, [f"#{r.n}  kare {r.frame}  t={r.t:.2f}s", f"kelime: {r.word}",
                                  f"açıklık {r.inner_open:.3f}  gen {r.mouth_width:.2f}",
                                  f"yuvarlak {r.roundness:.1f}  çene {r.jaw_open:.2f}",
                                  f"keskinlik {r.sharpness:.0f}  göz {r.blink:.2f}"], big=v))
        mt = cv2.resize(al[my0:my1, mx0:mx1], None, fx=1.4, fy=1.4, interpolation=cv2.INTER_CUBIC)
        mtiles.append(label(mt, [f"{r.frame} '{r.word}'"]))
    while len(tiles) < 3:
        tiles.append(np.zeros_like(tiles[0]) if tiles else np.zeros((cy1 - cy0, cx1 - cx0, 3), np.uint8))
        mtiles.append(np.zeros_like(mtiles[0]) if mtiles else np.zeros((int((my1 - my0) * 1.4), int((mx1 - mx0) * 1.4), 3), np.uint8))
    sheet = np.hstack([np.pad(t, ((4, 4), (4, 4), (0, 0))) for t in tiles])
    cv2.imwrite(str(OUT / f"contact_{v}.png"), sheet)
    head = np.zeros((mtiles[0].shape[0], 120, 3), np.uint8)
    head = label(head, [], big=v)
    rows_all.append(np.hstack([np.pad(head, ((3, 3), (0, 0), (0, 0)))] +
                              [np.pad(t, ((3, 3), (3, 3), (0, 0))) for t in mtiles]))
cv2.imwrite(str(OUT / "contact_all.png"), np.vstack(rows_all))
print("Kontak tabakaları yazıldı.")

# ---------------- alt yüz parçaları (feathered RGBA) ----------------
FEATHER = 18  # px (1080 çözünürlükte)


def lower_poly(P):
    return np.vstack([P[JAW_LINE], P[UPPER_BOUND[1:-1]][::-1]]).astype(np.int32)


meta = {}
for r in sel.itertuples():
    al = aligned(r.frame)
    P = aligned_lm(r.frame)
    mask = np.zeros((H, W), np.uint8)
    cv2.fillPoly(mask, [lower_poly(ref_lm)], 255)
    cv2.fillPoly(mask, [lower_poly(P)], 255)               # çene aşağı inerse onu da kapsa
    # çenenin altındaki gölge/boyun geçişi için maskeyi aşağı doğru genişlet
    k = np.zeros((41, 1), np.uint8); k[20:] = 1
    mask = cv2.dilate(mask, k, iterations=1)
    mask = cv2.erode(mask, np.ones((FEATHER, FEATHER), np.uint8))
    alpha = cv2.GaussianBlur(mask, (0, 0), FEATHER / 2)
    ys, xs = np.where(alpha > 2)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    rgba = np.dstack([al[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
    name = f"{r.viseme}_{r.n}.png"
    cv2.imwrite(str(PATCH_DIR / name), rgba)
    meta[name] = dict(viseme=r.viseme, n=r.n, src_frame=r.frame, src_time=r.t, x=int(x0), y=int(y0),
                      w=int(x1 - x0), h=int(y1 - y0), word=r.word)
save_json(dict(reference_frame=ref, frame_size=[W, H], feather_px=FEATHER, patches=meta), PATCH_DIR / "patches.json")
print(f"{len(meta)} parça yazıldı -> {PATCH_DIR}")
