"""Ses adayları için nesnel ölçümler: medyan temel frekans (F0) ve Whisper ile geri-okuma doğruluğu."""
import json, re, wave
import numpy as np
from tts_common import PROJECT
from c01_voices import TEXT
from faster_whisper import WhisperModel

model = WhisperModel("medium", device="cpu", compute_type="int8")
norm = lambda s: re.sub(r"[^\w\s]", "", s.lower().replace("I", "ı")).split()
ref = norm(TEXT)
rows = []
for f in sorted((PROJECT / "viseme_analysis" / "voices").glob("*.wav")):
    raw = f.read_bytes()[44:]
    x = np.frombuffer(raw[: len(raw) // 2 * 2], np.int16).astype(np.float32) / 32768
    sr = 24000
    f0 = []
    for i in range(0, len(x) - 1200, 480):           # 50 ms pencere, otokorelasyon
        w = x[i:i + 1200] * np.hanning(1200)
        if np.sqrt((w ** 2).mean()) < 0.02: continue
        ac = np.correlate(w, w, "full")[1199:]
        lo, hi = sr // 350, sr // 70
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.45 * ac[0]: f0.append(sr / k)
    x16 = np.interp(np.arange(0, len(x), 1.5), np.arange(len(x)), x).astype(np.float32)
    segs, _ = model.transcribe(x16, language="tr")
    hyp = norm(" ".join(s.text for s in segs))
    wrong = sum(a != b for a, b in zip(ref, hyp)) + abs(len(ref) - len(hyp))
    rows.append(dict(voice=f.stem, f0_median=round(float(np.median(f0)), 0), dur=round(len(x) / sr, 2), word_errors=wrong, heard=" ".join(hyp)))
    print(rows[-1])
(PROJECT / "viseme_analysis" / "voices" / "voice_stats.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
