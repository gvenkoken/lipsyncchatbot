"""ADIM 3b – Harf zamanlamasının görüntüyle iyileştirilmesi (yalnızca bu analiz için).
Whisper kelime zamanlarını harflere bölmek kare düzeyinde kaba kalıyor. Gerçek ürün TTS'ten kesin viseme
zamanı alacağı için, yöntemin kalitesini adil değerlendirmek amacıyla:
  1) tüm zaman çizelgesini LEAD kadar öne kaydır (ağız sesten önce şekil alır; ölçülen medyan ≈ 1 kare)
  2) her PBM harfini ±SNAP kare içindeki gerçek dudak kapanmasına oturt (komşu harfleri esnet)
Çıktılar: out/letters_refined.csv, out/visemes.csv (düzeltilmiş), out/timing_accuracy.json
"""
import numpy as np
import pandas as pd

from common import OUT, LIP_UP_IN, LIP_LO_IN, FOREHEAD, CHIN, save_json, video_info

LEAD = 0.040
SNAP = 3
CLOSED = 0.012
info = video_info()
FPS = info["fps"]
lm = np.load(OUT / "landmarks.npz")["lm"]
o = np.linalg.norm(lm[:, LIP_UP_IN, :2] - lm[:, LIP_LO_IN, :2], axis=1) / np.linalg.norm(
    lm[:, FOREHEAD, :2] - lm[:, CHIN, :2], axis=1)
n = len(o)
let = pd.read_csv(OUT / "letters.csv").fillna({"coart_vowel": ""})
words = pd.read_csv(OUT / "words.csv")


def pbm_hits(df, k=0):
    p = df[df.viseme == "PBM"]
    c = (((p.start + p.end) / 2) * FPS).astype(int).values
    return float(np.mean([(o[max(0, x - k):x + k + 1] < CLOSED).any() for x in c]))


acc = dict(raw_exact=pbm_hits(let), raw_pm1=pbm_hits(let, 1), raw_pm2=pbm_hits(let, 2))
let[["start", "end"]] -= LEAD
acc.update(shift_exact=pbm_hits(let), shift_pm1=pbm_hits(let, 1))

snapped = 0
let = let.reset_index(drop=True)
for i in let.index[let.viseme == "PBM"]:
    s, e = let.at[i, "start"], let.at[i, "end"]
    c = int((s + e) / 2 * FPS)
    w = np.arange(max(0, c - SNAP), min(n, c + SNAP + 1))
    cl = w[o[w] < CLOSED]
    if not len(cl):
        continue
    f = cl[np.argmin(np.abs(cl - c))]
    # kapanan kareler dizisini (bitişik) bul ve PBM'yi bu aralığa yerleştir
    a = b = f
    while a - 1 >= 0 and o[a - 1] < CLOSED and f - a < 3:
        a -= 1
    while b + 1 < n and o[b + 1] < CLOSED and b - f < 3:
        b += 1
    ns, ne = a / FPS, (b + 1) / FPS
    same_word = lambda j: 0 <= j < len(let) and let.at[j, "word_idx"] == let.at[i, "word_idx"]
    if same_word(i - 1):
        ns = max(ns, let.at[i - 1, "start"] + 0.02)
        let.at[i - 1, "end"] = ns
    if same_word(i + 1):
        ne = min(ne, let.at[i + 1, "end"] - 0.02)
        let.at[i + 1, "start"] = ne
    if ne > ns:
        let.at[i, "start"], let.at[i, "end"] = ns, ne
        snapped += 1
acc.update(refined_exact=pbm_hits(let), snapped=snapped, n_pbm=int((let.viseme == "PBM").sum()),
           lead_s=LEAD, snap_frames=SNAP)
let.to_csv(OUT / "letters_refined.csv", index=False)

# ---- SIL ekle ve birleştir (s03 ile aynı kural) ----
dur = n / FPS
tl, cur = [], 0.0
for r in let.itertuples():
    if r.start - cur > 0.08:
        tl.append(["SIL", cur, r.start, ""])
    elif tl and r.start > cur:
        tl[-1][2] = r.start
    tl.append([r.viseme, max(r.start, cur), r.end, r.coart_vowel])
    cur = max(cur, r.end)
if dur - cur > 0.01:
    tl.append(["SIL", cur, dur, ""])
merged = []
for v, s, e, c in tl:
    if e <= s:
        continue
    if merged and merged[-1][0] == v and merged[-1][3] == c and abs(merged[-1][2] - s) < 1e-6:
        merged[-1][2] = e
    else:
        merged.append([v, s, e, c])
vis = pd.DataFrame(merged, columns=["viseme", "start", "end", "coart_vowel"])
vis["dur"] = vis.end - vis.start
vis.to_csv(OUT / "visemes.csv", index=False)
save_json(acc, OUT / "timing_accuracy.json")
print("PBM etiketinin tam karede kapanmaya denk gelme oranı:")
for k, v in acc.items():
    print(f"  {k:14s} {v}")
