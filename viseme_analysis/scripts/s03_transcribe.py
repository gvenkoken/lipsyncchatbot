"""ADIM 3 – faster-whisper ile kelime zamanları + harf bazlı yaklaşık viseme zaman çizelgesi.
Kullanım: python s03_transcribe.py [small|medium]   (varsayılan: medium)
Çıktılar:
  out/audio16k.wav, out/transcript.txt, out/words.csv
  out/letters.csv   (her harf: zaman, viseme, KG için komşu ünlü)
  out/visemes.csv   (SIL dahil, ardışık aynı viseme'ler birleştirilmiş zaman çizelgesi)
"""
import sys
import wave

import numpy as np
import pandas as pd

from common import FFMPEG, VIDEO, OUT, run

MODEL = sys.argv[1] if len(sys.argv) > 1 else "medium"
wav = OUT / "audio16k.wav"
if not wav.exists():
    run([FFMPEG, "-v", "error", "-y", "-i", str(VIDEO), "-vn", "-ac", "1", "-ar", "16000", str(wav)])

words_csv = OUT / f"words_{MODEL}.csv"
if not words_csv.exists():
    from faster_whisper import WhisperModel
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    with wave.open(str(wav)) as wf:  # PyAV sürüm uyumsuzluğundan kaçınmak için diziyi doğrudan ver
        audio = np.frombuffer(wf.readframes(wf.getnframes()), np.int16).astype(np.float32) / 32768
    segs, info = model.transcribe(audio, language="tr", word_timestamps=True, beam_size=5,
                                  vad_filter=False, condition_on_previous_text=True)
    rows, text = [], []
    for s in segs:
        text.append(s.text.strip())
        for w in s.words:
            rows.append(dict(word=w.word.strip(), start=w.start, end=w.end, prob=w.probability))
        print(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text.strip()}")
    pd.DataFrame(rows).to_csv(words_csv, index=False)
    (OUT / f"transcript_{MODEL}.txt").write_text("\n".join(text), encoding="utf-8")
words = pd.read_csv(words_csv)
words.to_csv(OUT / "words.csv", index=False)
(OUT / "transcript.txt").write_text((OUT / f"transcript_{MODEL}.txt").read_text(encoding="utf-8"), encoding="utf-8")

# ---- enerji zarfı (10 ms) – kelime sınırlarını sessizliğe göre kırpmak için ----
with wave.open(str(wav)) as wf:
    sr = wf.getframerate()
    x = np.frombuffer(wf.readframes(wf.getnframes()), np.int16).astype(np.float32) / 32768
hop = sr // 100
rms = np.sqrt(np.convolve(x ** 2, np.ones(hop * 2) / (hop * 2), mode="same")[::hop] + 1e-12)
db = 20 * np.log10(rms)
floor, peak = np.percentile(db, 10), np.percentile(db, 95)
sil_thr = floor + 0.25 * (peak - floor)     # bu eşiğin altı sessizlik sayılır
print(f"Enerji: taban {floor:.1f} dB, tepe {peak:.1f} dB, sessizlik eşiği {sil_thr:.1f} dB")


def voiced(t0, t1):
    a, b = int(t0 * 100), max(int(t0 * 100) + 1, int(t1 * 100))
    return db[a:b] > sil_thr


def trim(t0, t1):
    """Kelimenin başında/sonunda 60 ms'den uzun sessiz kısmı kes (Whisper sınırları sarkıtır)."""
    v = voiced(t0, t1)
    if not v.any():
        return t0, t1
    idx = np.where(v)[0]
    s = t0 + max(0, idx[0] - 3) / 100      # 30 ms pay (patlamalı ünsüzler sessiz başlar)
    e = t0 + min(len(v), idx[-1] + 4) / 100
    return s, max(e, s + 0.05)


# ---- harf -> viseme ----
VMAP = {}
for ch in "pbm": VMAP[ch] = "PBM"
for ch in "fv": VMAP[ch] = "FV"
for ch in "tdnlr": VMAP[ch] = "DNT"
for ch in "sz": VMAP[ch] = "SZ"
for ch in "şçcj": VMAP[ch] = "SH"
for ch in "kghy": VMAP[ch] = "KG"
VMAP.update(a="A", e="E", i="I", ı="I", o="O", ö="O", u="U", ü="U")
VOWELS = set("aeıioöuü")
NORM = {"â": "a", "î": "i", "û": "u", "q": "k", "w": "v", "x": "ks"}
V_W, C_W = 1.6, 1.0   # ünlüler ünsüzlerden ~%60 daha uzun


def tr_lower(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def letters_of(word: str):
    out = []
    for ch in tr_lower(word):
        ch = NORM.get(ch, ch)
        for c in ch:
            if c == "ğ":
                if out and out[-1][0] in VOWELS:
                    out[-1][1] += 0.8      # ğ önceki ünlüyü uzatır
                continue
            if c in VMAP:
                out.append([c, V_W if c in VOWELS else C_W])
    return out


rows, skipped = [], []
for wi, w in words.iterrows():
    L = letters_of(str(w.word))
    if not L:
        skipped.append(w.word)
        continue
    s, e = trim(float(w.start), float(w.end))
    # Aşırı uzun kelimeler (harf başına >180 ms) Whisper'ın sessizliği yuttuğunu gösterir: sondan kes
    max_dur = sum(l[1] for l in L) * 0.18
    if e - s > max_dur:
        e = s + max_dur
    tot = sum(l[1] for l in L)
    t = s
    for li, (c, wgt) in enumerate(L):
        d = (e - s) * wgt / tot
        rows.append(dict(word_idx=wi, word=w.word, letter=c, viseme=VMAP[c], start=t, end=t + d))
        t += d
let = pd.DataFrame(rows)

# KG: komşu ünlüyü not et (önce sonraki, yoksa önceki ünlü, aynı kelime içinde)
co = []
for i, r in let.iterrows():
    if r.viseme != "KG":
        co.append(""); continue
    same = let[let.word_idx == r.word_idx]
    nxt = same[(same.index > i) & same.letter.isin(VOWELS)]
    prv = same[(same.index < i) & same.letter.isin(VOWELS)]
    v = nxt.iloc[0].viseme if len(nxt) else (prv.iloc[-1].viseme if len(prv) else "")
    co.append(v)
let["coart_vowel"] = co
let.to_csv(OUT / "letters.csv", index=False)

# ---- SIL ekle ve birleştir ----
dur = len(x) / sr
tl, cur = [], 0.0
for r in let.itertuples():
    if r.start - cur > 0.08:
        tl.append(["SIL", cur, r.start, ""])
    elif tl and r.start > cur:
        tl[-1][2] = r.start            # küçük boşluğu önceki harfe kat
    tl.append([r.viseme, r.start, r.end, r.coart_vowel])
    cur = r.end
if dur - cur > 0.01:
    tl.append(["SIL", cur, dur, ""])
merged = []
for v, s, e, c in tl:
    if merged and merged[-1][0] == v and merged[-1][3] == c and abs(merged[-1][2] - s) < 1e-6:
        merged[-1][2] = e
    else:
        merged.append([v, s, e, c])
vis = pd.DataFrame(merged, columns=["viseme", "start", "end", "coart_vowel"])
vis["dur"] = vis.end - vis.start
vis.to_csv(OUT / "visemes_raw.csv", index=False)
vis.to_csv(OUT / "visemes.csv", index=False)   # s03b_refine.py bunu düzeltilmiş sürümle değiştirir

print(f"Kelime: {len(words)}, harf: {len(let)}, atlanan (harf içermeyen): {skipped}")
print("Viseme toplam süre (s):")
print(vis.groupby("viseme").dur.agg(["count", "sum"]).round(2).to_string())
