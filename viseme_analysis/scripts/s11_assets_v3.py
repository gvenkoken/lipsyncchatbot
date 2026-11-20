"""Varlıklar v3 – ekran kaydı incelemesinden (review_20261113) çıkan düzeltmeler.
out/ ve out_v2/ çıktılarına dokunmaz; yalnızca okur. Yazdıkları:
  viseme_analysis/out_v3/  (selected_v3.csv, contact_all_v3.png, önizlemeler)
  <proje>/public/viseme-rig/  (atlas@1x.webp, atlas@2x.webp, manifest.json)

Fark: medyan yerine her viseme kendi "yönünde" belirgin karelerden seçilir (A: açık, E: geniş+açık,
I: geniş+dar aralık, O/U: yuvarlak), her biri 3 varyant, taban kareye hizalama hatası < 2 px.

v3 farkları:
  1. Yama üst sınırı burnun altında: burun ve burun yanları her zaman taban kareden gelir.
  2. Seçimde ifade tutarlılığı: gülümseme / yanak / burun blendshape'leri, burun ve yanak landmark kayması
     ve dikiş bandındaki piksel farkı puanlanır; E/I/SZ için aşırı geniş (sırıtan) kareler hedeflenmez.
"""
import json
import sys

import cv2
import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

from common import OUT, ROOT, STABLE, JAW_LINE, UPPER_BOUND, OUTER_LIP, read_frames, video_info

OUT2 = ROOT / "out_v3"
OUT2.mkdir(exist_ok=True)
RIG = ROOT.parent / "public" / "viseme-rig"
RIG.mkdir(parents=True, exist_ok=True)

BASE_FRAME = 1342                 # ağız kapalı, göz açık, medyan poz, çok sabit bölüm
BLINK_RANGE = (1590, 1612)        # 63,4 s civarındaki göz kırpması
CROP = dict(x=132, y=0, s=840)    # taban karede gösterilecek kare bölge (baş + omuz)
LOGICAL = 320                     # mantıksal tuval (1x); 2x = 640
FEATHER = 16
TOP_OFFSET = 3                    # yama üst sınırı: burun altı (landmark 2) + bu kadar kaynak pikseli
SEAM_CANDIDATES = 40              # viseme başına dikiş maliyeti ölçülecek aday sayısı
SHAPE_SLACK = 0.3                 # şekil puanı en iyiden en çok bu kadar kötü olan adaylar değerlendirilir
MAX_RESID = 2.0

info = video_info()
W, H, FPS = info["w"], info["h"], info["fps"]
m = pd.read_csv(OUT / "frame_metrics.csv")
_npz = np.load(OUT / "landmarks.npz", allow_pickle=True)
lm = _npz["lm"][:, :, :2]
BLEND = _npz["blend"]; BNAMES = [str(n) for n in _npz["names"]]
N = len(m)

# ---------- taban kareye hizalama ----------
dst = lm[BASE_FRAME, STABLE]
AB = np.zeros((N, 2, 3), np.float32)
resB = np.zeros(N)
for i in range(N):
    M, _ = cv2.estimateAffinePartial2D(lm[i, STABLE], dst, method=cv2.LMEDS)
    AB[i] = M
    p = lm[i, STABLE] @ M[:, :2].T + M[:, 2]
    resB[i] = np.sqrt(((p - dst) ** 2).sum(1).mean())
m["resB"] = resB
# ---------- ifade tutarlılığı: burun / yanak kayması ve gülümseme ----------
NOSE_PTS = [1, 2, 4, 5, 195, 98, 327, 97, 326, 48, 278]
CHEEK_PTS = [205, 425, 206, 426, 203, 423, 187, 411]
ALL = np.einsum("nkj,nij->nki", lm, AB[:, :, :2]) + AB[:, None, :, 2]
m["nose_res"] = np.sqrt(((ALL[:, NOSE_PTS] - lm[BASE_FRAME, NOSE_PTS]) ** 2).sum(-1).mean(1))
m["cheek_res"] = np.sqrt(((ALL[:, CHEEK_PTS] - lm[BASE_FRAME, CHEEK_PTS]) ** 2).sum(-1).mean(1))
bs = lambda *names: BLEND[:, [BNAMES.index(n) for n in names]].mean(1)
EXPR = {"smile": bs("mouthSmileLeft", "mouthSmileRight"), "cheek": bs("cheekSquintLeft", "cheekSquintRight"),
        "sneer": bs("noseSneerLeft", "noseSneerRight"), "dimple": bs("mouthDimpleLeft", "mouthDimpleRight")}
expr = np.zeros(N)
for k, v in EXPR.items():
    expr += np.clip(v - v[BASE_FRAME], 0, None) / (v.std() + 1e-6)
m["expr"] = expr / len(EXPR)
print("ifade ölçüleri (medyan / %90):", {k: (round(float(m[k].median()), 2), round(float(m[k].quantile(.9)), 2)) for k in ("nose_res", "cheek_res", "expr")})
# içerik-düzeltilmiş keskinlik
bins = pd.qcut(m.inner_open, 10, labels=False, duplicates="drop")
m["sharp_rel"] = m.sharpness / m.groupby(bins).sharpness.transform("median")

FEATS = ["inner_open", "mouth_width", "roundness", "jaw_open", "bs_mouthPucker", "bs_mouthFunnel",
         "teeth_ratio", "bs_mouthRollLower"]
SD = {f: max(1.4826 * np.median(np.abs(m[f] - m[f].median())), 0.5 * m[f].std()) + 1e-6 for f in FEATS}

good = m[(m.resB < MAX_RESID) & (m.sharp_rel > 0.75) & (m.jitter_px < 2.5) & (m.scale.between(0.975, 1.025))]
# ünlülerde ağız mutlaka aralık olmalı (etiket gürültüsünden gelen kapalı kareleri ele)
vowel = lambda v: good[(good.viseme == v) & (good.seg_dur >= 0.08) & good.seg_relpos.between(0.15, 0.85) & (good.inner_open > 0.015)]
cons = lambda v: good[(good.viseme == v) & good.seg_relpos.between(0.1, 0.9)]

# viseme -> (aday havuzu, {özellik: (yüzdelik, ağırlık)})   yüzdelik havuzun kendi dağılımına göre
SPEC = {
    "SIL": (good[(good.viseme == "SIL") & (good.seg_dur >= 0.4) & (good.inner_open < 0.006)],
            {"mouth_width": (.5, 1), "roundness": (.5, 1), "jaw_open": (.4, 1)}),
    "REST_OPEN": (good[good.inner_open.between(0.014, 0.026) & (good.bs_mouthPucker < good.bs_mouthPucker.quantile(.6))],
                  {"inner_open": (.5, 2), "mouth_width": (.4, 1), "roundness": (.5, 1)}),
    "PBM": (good[(good.viseme == "PBM") & (good.inner_open < 0.006)],
            {"mouth_width": (.5, 1), "roundness": (.5, 1), "bs_mouthRollLower": (.6, 1)}),
    "FV": (cons("FV")[lambda d: d.inner_open < 0.035],
           {"inner_open": (.3, 2), "bs_mouthRollLower": (.8, 1.5), "teeth_ratio": (.7, 1)}),
    "DNT": (cons("DNT"), {"inner_open": (.5, 1), "mouth_width": (.5, 1), "roundness": (.5, 1), "jaw_open": (.5, 1)}),
    "SZ": (cons("SZ"), {"mouth_width": (.6, 1.5), "inner_open": (.4, 1), "teeth_ratio": (.8, 1.5)}),
    "SH": (cons("SH"), {"bs_mouthFunnel": (.85, 2), "roundness": (.2, 1.5), "inner_open": (.5, 1)}),
    "KG": (cons("KG"), {"inner_open": (.5, 1), "mouth_width": (.5, 1), "roundness": (.5, 1), "jaw_open": (.5, 1)}),
    "A": (vowel("A"), {"inner_open": (.85, 2.5), "jaw_open": (.8, 1), "mouth_width": (.4, 1.5)}),
    "E": (vowel("E"), {"mouth_width": (.65, 2.5), "inner_open": (.6, 1.5)}),
    "I": (vowel("I"), {"mouth_width": (.6, 2.5), "inner_open": (.4, 2)}),
    "O": (vowel("O"), {"roundness": (.15, 2), "mouth_width": (.2, 1.5), "inner_open": (.65, 1.5)}),
    "U": (vowel("U"), {"mouth_width": (.15, 2), "roundness": (.2, 1.5), "inner_open": (.45, 1.5), "bs_mouthPucker": (.8, 1)}),
}
ORDER = list(SPEC)

base_lm = lm[BASE_FRAME]
Y_TOP = int(round(base_lm[2][1] + TOP_OFFSET))
print(f"yama üst sınırı y={Y_TOP} (burun altı {base_lm[2][1]:.0f}, üst dudak tepesi {base_lm[0][1]:.0f}, burun kanadı {base_lm[98][1]:.0f})")


def feathered(mask, feather=FEATHER):
    mask = cv2.erode(mask, np.ones((feather, feather), np.uint8))
    return cv2.GaussianBlur(mask, (0, 0), feather / 2)


def lower_poly(P):
    return np.vstack([P[JAW_LINE], P[UPPER_BOUND[1:-1]][::-1]]).astype(np.int32)


def mouth_alpha(P=None):
    mask = np.zeros((H, W), np.uint8)
    cv2.fillPoly(mask, [lower_poly(base_lm)], 255)
    if P is not None:
        cv2.fillPoly(mask, [lower_poly(P)], 255)
    mask[:Y_TOP] = 0                      # burun ve burun yanları taban kareden
    return feathered(mask)


_ba = mouth_alpha().astype(np.float32) / 255
SEAM = (_ba > .03) & (_ba < .97)          # geçiş bandı
SEAM_TOP = SEAM & (np.arange(H)[:, None] < Y_TOP + 3 * FEATHER)
_base_img = cv2.cvtColor(read_frames([BASE_FRAME])[BASE_FRAME], cv2.COLOR_BGR2LAB).astype(np.float32)


def seam_cost(frame_ids):
    fr = read_frames(sorted(set(int(i) for i in frame_ids)))
    out = {}
    for i, img in fr.items():
        al = cv2.cvtColor(cv2.warpAffine(img, AB[i], (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE), cv2.COLOR_BGR2LAB).astype(np.float32)
        d = np.abs(cv2.GaussianBlur(al - _base_img, (0, 0), 2)).sum(-1)
        out[i] = float(d[SEAM_TOP].mean() * .7 + d[SEAM].mean() * .3)
    return out


rows = []
for v, (pool, spec) in SPEC.items():
    if len(pool) < 3:
        sys.exit(f"{v}: yeterli aday yok ({len(pool)})")
    # aşırı kareleri ele: hedef özelliklerde havuzun %3–%97 dışı
    keep = np.ones(len(pool), bool)
    for f in ("inner_open", "mouth_width", "roundness", "jaw_open"):
        lo, hi = pool[f].quantile(.03), pool[f].quantile(.97)
        keep &= pool[f].between(lo, hi).values
    pool = pool[keep] if keep.sum() >= 6 else pool
    tgt = {f: pool[f].quantile(q) for f, (q, _) in spec.items()}
    score = sum(wt * ((pool[f] - tgt[f]) / SD[f]).abs() for f, (_, wt) in spec.items()) / sum(w for _, w in spec.values())
    score = score + pool.resB / 4 + np.clip(1 - pool.sharp_rel, 0, None)
    # önce ağız şekli: yalnızca şekli hedefe yakın adaylar arasında ifade / dikiş tutarlılığına bakılır
    near = score <= max(score.min() + SHAPE_SLACK, score.nsmallest(min(len(score), 12)).iloc[-1])
    pool, score = pool[near.values], score[near.values]
    score = score + pool.nose_res / 3 + pool.cheek_res / 5 + pool.expr * .5
    order = pool.assign(score=score).sort_values("score").head(SEAM_CANDIDATES)
    seam = seam_cost(order.frame)
    order = order.assign(seam=[seam[int(f)] for f in order.frame])
    order = order.assign(score=order.score + order.seam / 8).sort_values("score")
    first = order.iloc[0]
    picked = [first]
    shape = ["inner_open", "mouth_width", "roundness"]
    for relax in (1.0, 1.6, 2.5):                 # 3 varyant bulunamazsa koşulları kademeli gevşet
        for r in order.iloc[1:].itertuples():
            if len(picked) == 3:
                break
            if any(abs(r.frame - p.frame) < 20 for p in picked):      # farklı geçişlerden
                continue
            # varyantlar birbirine yakın (ani sıçrama olmasın) ve hedefe uygun olsun
            if abs(r.inner_open - first.inner_open) > 0.012 * relax or abs(r.mouth_width - first.mouth_width) > 0.03 * relax:
                continue
            if r.score > max(first.score * 2.5, first.score + 0.6) * relax:
                continue
            picked.append(r)
    for n, r in enumerate(picked, 1):
        rows.append(dict(viseme=v, n=n, frame=int(r.frame), t=round(float(r.t), 2), label=r.viseme, score=round(float(r.score), 3),
                         resB=round(float(r.resB), 2), **{f: round(float(getattr(r, f) if not isinstance(r, pd.Series) else r[f]), 4)
                                                          for f in ["inner_open", "mouth_width", "roundness", "jaw_open", "sharp_rel", "nose_res", "cheek_res", "expr", "seam"]}))
    if len(picked) < 3:
        print(f"UYARI {v}: yalnızca {len(picked)} varyant bulundu")
sel = pd.DataFrame(rows)
sel.to_csv(OUT2 / "selected_v3.csv", index=False)
print(sel.to_string(index=False))

# ---------- göz kırpması kareleri ----------
b = m.blink.values
a0, a1 = BLINK_RANGE
peak = a0 + int(np.argmax(b[a0:a1]))
open_level = np.median(b[a0:a0 + 5])
s = peak
while s > a0 and b[s - 1] > open_level + 0.04:
    s -= 1
e = peak
while e < a1 and b[e + 1] > open_level + 0.04:
    e += 1
blink_frames = list(range(s - 1, e + 2))
print(f"Göz kırpması: tepe {peak} (skor {b[peak]:.2f}), kareler {blink_frames[0]}–{blink_frames[-1]}, hizalama hatası maks {resB[blink_frames].max():.2f}px")

# ---------- görüntüleri hazırla ----------
need = sorted(set(sel.frame.tolist() + blink_frames + [BASE_FRAME]))
frames = read_frames(need)
aligned = {i: cv2.warpAffine(frames[i], AB[i], (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE) for i in need}
al_lm = lambda i: lm[i] @ AB[i][:, :2].T + AB[i][:, 2]


EYE_PTS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 33, 7, 163, 144, 145, 153, 154, 155, 133,
           362, 382, 381, 380, 374, 373, 390, 249, 263, 46, 276, 111, 340]
eye_mask = np.zeros((H, W), np.uint8)
cv2.fillConvexPoly(eye_mask, cv2.convexHull(base_lm[EYE_PTS].astype(np.int32)), 255)
eye_alpha = feathered(cv2.dilate(eye_mask, np.ones((40, 40), np.uint8)), 14)

sprites_full = {"base": (aligned[BASE_FRAME], None)}
vis_names = {}
for r in sel.itertuples():
    name = f"{r.viseme}_{r.n}"
    sprites_full[name] = (aligned[r.frame], mouth_alpha(al_lm(r.frame)))
    vis_names.setdefault(r.viseme, []).append(name)
blink_names = []
for k, i in enumerate(blink_frames):
    name = f"eye_{k}"
    sprites_full[name] = (aligned[i], eye_alpha)
    blink_names.append(name)

# ---------- atlas (her ölçek için) ----------
cx, cy, S = CROP["x"], CROP["y"], CROP["s"]
PAD = 2


def build(scale_n):
    n_px = LOGICAL * scale_n
    f = n_px / LOGICAL                       # atlas pikseli / mantıksal birim
    items = []
    for name, (img, alpha) in sprites_full.items():
        crop = img[cy:cy + S, cx:cx + S]
        small = cv2.resize(crop, (n_px, n_px), interpolation=cv2.INTER_AREA)
        if alpha is None:
            rgba = np.dstack([small, np.full((n_px, n_px), 255, np.uint8)])
            x0, y0, x1, y1 = 0, 0, n_px, n_px
        else:
            a = cv2.resize(alpha[cy:cy + S, cx:cx + S], (n_px, n_px), interpolation=cv2.INTER_AREA)
            ys, xs = np.where(a > 1)
            x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            rgba = np.dstack([small, a])
        items.append((name, rgba[y0:y1, x0:x1], (x0, y0)))
    # raf (shelf) yerleşimi – yüksekliğe göre sırala
    maxw = 1024 * scale_n
    items.sort(key=lambda it: -it[1].shape[0])
    x = y = shelf = 0
    place = {}
    for name, im, off in items:
        h, w = im.shape[:2]
        if x + w + PAD > maxw:
            x, y, shelf = 0, y + shelf + PAD, 0
        place[name] = (x, y, w, h, off)
        x += w + PAD
        shelf = max(shelf, h)
    atlas = np.zeros((y + shelf, maxw, 4), np.uint8)
    for name, im, off in items:
        px, py, w, h, _ = place[name]
        atlas[py:py + h, px:px + w] = im
    used_w = max(p[0] + p[2] for p in place.values())
    atlas = atlas[:, :used_w]
    file = f"atlas@{scale_n}x.webp"
    Image.fromarray(cv2.cvtColor(atlas, cv2.COLOR_BGRA2RGBA)).save(RIG / file, "WEBP", quality=90, alpha_quality=95, method=6, exact=True)
    return file, atlas, {name: dict(rect=[px, py, w, h], dest=[off[0] / f, off[1] / f, w / f, h / f]) for name, (px, py, w, h, off) in place.items()}


manifest = dict(version=3, logical=dict(width=LOGICAL, height=LOGICAL), source=dict(video="inputs/reference.mp4", base_frame=BASE_FRAME, crop=CROP),
                atlases={}, sprites={}, base="base", visemes=vis_names, blink=blink_names,
                blink_fps=FPS)
atl = {}
for sc in (1, 2):
    file, atlas, place = build(sc)
    atl[sc] = (atlas, place)
    manifest["atlases"][str(sc)] = dict(file=file, width=int(atlas.shape[1]), height=int(atlas.shape[0]))
    for name, p in place.items():
        sp = manifest["sprites"].setdefault(name, dict(dest=[round(v, 4) for v in p["dest"]], rect={}))
        sp["rect"][str(sc)] = p["rect"]
        if sc == 2:   # hedef konum 2x ızgarasına göre daha hassas
            sp["dest"] = [round(v, 4) for v in p["dest"]]
# 1x ve 2x hedefleri birbirinden en fazla yarım 1x pikseli farklıdır; oynatıcı ölçeğe göre rect + kendi dest'ini kullanır
for name in manifest["sprites"]:
    manifest["sprites"][name]["dest1"] = [round(v, 4) for v in atl[1][1][name]["dest"]]
# baş hareketi için pivot (boyun) ve ağız merkezi – mantıksal birim
to_log = lambda p: [round(float((p[0] - cx) * LOGICAL / S), 2), round(float((p[1] - cy) * LOGICAL / S), 2)]
manifest["anchors"] = dict(pivot=to_log((base_lm[152][0], base_lm[152][1] + 90)), mouth=to_log(base_lm[OUTER_LIP].mean(0)),
                           eyes=to_log(base_lm[[33, 263]].mean(0)))
manifest["letter_to_viseme"] = {"PBM": "pbm", "FV": "fv", "DNT": "tdnlr", "SZ": "sz", "SH": "şçcj", "KG": "kghy",
                                "A": "a", "E": "e", "I": "iı", "O": "oö", "U": "uü"}
(RIG / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
total = sum((RIG / manifest["atlases"][k]["file"]).stat().st_size for k in manifest["atlases"]) + (RIG / "manifest.json").stat().st_size
for k, a in manifest["atlases"].items():
    print(f"atlas {k}x: {a['width']}x{a['height']}  {(RIG / a['file']).stat().st_size / 1024:.0f} KB")
print(f"Toplam: {total / 1024 / 1024:.2f} MB (hedef < 3 MB)")

# ---------- kontak tabakası: atlastan (WebP'den geri okunarak) taban + parça birleşimi ----------
def composite(scale_n, names):
    atlas = cv2.cvtColor(np.array(Image.open(RIG / manifest["atlases"][str(scale_n)]["file"]).convert("RGBA")), cv2.COLOR_RGBA2BGRA)
    place = atl[scale_n][1]
    f = scale_n
    px, py, w, h = place["base"]["rect"]
    out = atlas[py:py + h, px:px + w, :3].astype(np.float32)
    for name in names:
        px, py, w, h = place[name]["rect"]
        dx, dy = (int(round(v * f)) for v in place[name]["dest"][:2])
        sp = atlas[py:py + h, px:px + w].astype(np.float32)
        a = sp[..., 3:] / 255
        out[dy:dy + h, dx:dx + w] = out[dy:dy + h, dx:dx + w] * (1 - a) + sp[..., :3] * a
    return out.astype(np.uint8)


try:
    FONT = ImageFont.truetype("arialbd.ttf", 20); FONT_S = ImageFont.truetype("arial.ttf", 14)
except OSError:
    FONT = FONT_S = ImageFont.load_default()
mx, my = (v * 2 for v in manifest["anchors"]["mouth"])
x0, y0, cw, ch = int(mx - 110), int(my - 110), 220, 200
rows_img = []
for v in ORDER:
    tiles = []
    for name in vis_names[v]:
        im = composite(2, [name])[y0:y0 + ch, x0:x0 + cw]
        im = cv2.resize(im, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
        r = sel[(sel.viseme == v) & (sel.n == int(name.split("_")[-1]))].iloc[0]
        pil = Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)); dr = ImageDraw.Draw(pil)
        dr.text((6, 4), f"{r.frame} aç {r.inner_open:.3f} gen {r.mouth_width:.2f}", font=FONT_S, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        tiles.append(np.pad(cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR), ((3, 3), (3, 3), (0, 0))))
    head = Image.new("RGB", (150, tiles[0].shape[0]), (0, 0, 0)); ImageDraw.Draw(head).text((8, 8), v, font=FONT, fill=(255, 220, 60))
    while len(tiles) < 3:
        tiles.append(np.zeros_like(tiles[0]))
    rows_img.append(np.hstack([cv2.cvtColor(np.array(head), cv2.COLOR_RGB2BGR)] + tiles))
cv2.imwrite(str(OUT2 / "contact_all_v3.png"), np.vstack(rows_img))
# tam avatar önizlemeleri (1x ve 2x) + göz kırpması şeridi
cv2.imwrite(str(OUT2 / "preview_base_2x.png"), composite(2, []))
cv2.imwrite(str(OUT2 / "preview_A_1x.png"), composite(1, [vis_names["A"][0]]))
cv2.imwrite(str(OUT2 / "preview_blink_2x.png"), np.hstack([composite(2, [n])[150:330, 150:490] for n in blink_names]))
cv2.imwrite(str(OUT2 / "preview_AEI_2x.png"), np.hstack([composite(2, [vis_names[v][0]]) for v in ("A", "E", "I", "O", "U")]))
# tabana göre fark haritası: yama dışında (burun, burun yanları) fark sıfır olmalı
base2 = composite(2, []).astype(np.int16)
worst = np.zeros(base2.shape[:2], np.float32)
for v in ORDER:
    for name in vis_names[v]:
        worst = np.maximum(worst, np.abs(composite(2, [name]).astype(np.int16) - base2).mean(-1))
cv2.imwrite(str(OUT2 / "diff_max_2x.png"), np.hstack([base2.astype(np.uint8), cv2.applyColorMap(np.clip(worst * 5, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)]))
print("Yazıldı: contact_all_v3.png ve önizlemeler")
