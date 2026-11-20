"""AŞAMA C – Kalibrasyon verisi: 30 Türkçe cümle -> OpenAI TTS (seçili ses) + faster-whisper kelime zamanları.
Çıktı: viseme_analysis/out_v2/calib/<id>.wav (16 bit mono, düzgün başlık) ve calib/dataset.json
Hizalayıcının kendisi TypeScript'tedir; ölçüm ve ayar: node scripts/avatar-calibrate.mjs
"""
import json, re, sys, wave
import numpy as np
from tts_common import PROJECT, TTS_VOICE, TTS_MODEL, tts

SENTENCES = [
    "Merhaba, size nasıl yardımcı olabilirim?",
    "Tabii, hemen bakıyorum.",
    "Bugün hava çok güzel, dışarıda yürüyüş yapmak için harika bir gün.",
    "Siparişiniz yarın öğleden sonra teslim edilecek.",
    "Bunu biraz daha açabilir misiniz?",
    "Anladım, o zaman önce hesabınızı kontrol edelim.",
    "Maalesef bu özellik şu anda kullanılamıyor, ama yakında eklenecek.",
    "Evet, doğru söylüyorsunuz.",
    "Toplantı saat üçte başlıyor, isterseniz size hatırlatma kurabilirim.",
    "Bir saniye, bilgileri getiriyorum.",
    "Şifrenizi sıfırlamak için size bir bağlantı gönderdim.",
    "Çok teşekkür ederim, iyi günler dilerim!",
    "Bu konuda üç farklı seçeneğiniz var: aylık, yıllık veya kurumsal paket.",
    "Hayır, ek bir ücret ödemeniz gerekmiyor.",
    "Pembe bir bulut, mavi gökyüzünde yavaşça süzülüyordu.",
    "Babam bana küçük bir bahçe kulübesi yaptı.",
    "Fırından yeni çıkmış ekmeğin kokusu bütün sokağa yayıldı.",
    "Şu köşedeki çiçekçi her sabah erkenden açılıyor.",
    "İstanbul'da vapurla karşıya geçmek her zaman keyifli.",
    "Öğrendiğime göre proje gelecek hafta tamamlanacak.",
    "Peki, başka bir sorunuz var mı?",
    "Lütfen adınızı ve e-posta adresinizi söyler misiniz?",
    "Harika! O halde başlayalım.",
    "Uzun bir yolculuktan sonra nihayet eve vardık ve hemen dinlenmeye çekildik.",
    "Bu işlem genellikle iki ile beş dakika arasında sürüyor.",
    "Özür dilerim, sizi tam olarak anlayamadım.",
    "Mümkünse yarın sabah tekrar arayın, o zaman daha net bilgi verebilirim.",
    "Kitap okumak, müzik dinlemek ve yüzmek en sevdiğim etkinlikler.",
    "Güzel bir soru, biraz düşüneyim.",
    "Hoşça kalın, yine görüşmek üzere!",
]
out = PROJECT / "viseme_analysis" / "out_v2" / "calib"
out.mkdir(parents=True, exist_ok=True)
SR = 24000
audio = {}
for i, text in enumerate(SENTENCES):
    f = out / f"s{i:02d}.wav"
    if not f.exists():
        raw = tts(text)[44:]            # akış başlığı güvenilmez; PCM'i al, düzgün başlıkla yeniden yaz
        with wave.open(str(f), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(raw[: len(raw) // 2 * 2])
    with wave.open(str(f)) as w:
        audio[i] = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    print(f"s{i:02d} {len(audio[i]) / SR:5.2f}s  {text}")

from faster_whisper import WhisperModel
model = WhisperModel("medium", device="cpu", compute_type="int8")
norm = lambda s: re.sub(r"[^\w]", "", s.replace("I", "ı").replace("İ", "i").lower())
data, dropped = [], 0
for i, text in enumerate(SENTENCES):
    x = audio[i]
    x16 = np.interp(np.arange(0, len(x), SR / 16000), np.arange(len(x)), x).astype(np.float32)
    segs, _ = model.transcribe(x16, language="tr", word_timestamps=True, beam_size=5, initial_prompt=text)
    words = [dict(word=w.word.strip(), start=round(w.start, 3), end=round(w.end, 3)) for s in segs for w in s.words]
    ref = [norm(t) for t in text.split() if norm(t)]
    ok = [norm(w["word"]) for w in words] == ref      # yalnızca kelimesi kelimesine eşleşen cümleler referans olur
    dropped += not ok
    data.append(dict(id=f"s{i:02d}", text=text, wav=f"s{i:02d}.wav", duration=round(len(x) / SR, 3), words=words, exact=ok))
(out / "dataset.json").write_text(json.dumps(dict(voice=TTS_VOICE, model=TTS_MODEL, sample_rate=SR, items=data), ensure_ascii=False, indent=1), encoding="utf-8")
print(f"Yazıldı: dataset.json  ({len(data)} cümle, {dropped} tanesi kelime eşleşmediği için ölçüm dışı)")
