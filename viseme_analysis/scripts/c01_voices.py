"""AŞAMA C – Ses seçimi: OpenAI'nin yerleşik seslerinin hepsiyle aynı Türkçe cümle -> viseme_analysis/voices/<ses>.wav"""
import sys
import wave

from tts_common import PROJECT, TTS_MODEL, tts

VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"]
TEXT = "Merhaba, ben dijital asistanınızım. Bugün size nasıl yardımcı olabilirim? İsterseniz birlikte kısa bir plan yapalım."
out = PROJECT / "viseme_analysis" / "voices"
out.mkdir(exist_ok=True)
print(f"model: {TTS_MODEL}")
for v in VOICES:
    f = out / f"{v}.wav"
    try:
        if not f.exists():
            tts(TEXT, v, f)
        with wave.open(str(f)) as w:
            # OpenAI akış WAV başlığında uzunluk bilinmeyebilir; süreyi dosya boyutundan hesapla
            dur = (f.stat().st_size - 44) / (w.getframerate() * w.getnchannels() * w.getsampwidth())
            print(f"{v:8s} {w.getframerate()} Hz  {dur:5.2f} s")
    except Exception as e:  # desteklenmeyen ses adı vb.
        print(f"{v:8s} ÜRETİLEMEDİ: {e}", file=sys.stderr)
