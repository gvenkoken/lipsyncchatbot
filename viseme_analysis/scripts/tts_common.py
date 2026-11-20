"""OpenAI TTS yardımcıları (çevrimdışı kalibrasyon için). Anahtar yalnızca .env.local/.env'den okunur, asla yazdırılmaz."""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
INSTRUCTIONS = "Doğal, akıcı İstanbul Türkçesiyle, samimi ve sakin genç bir erkek gibi konuş."


def load_env() -> dict:
    env = {}
    for name in (".env", ".env.local"):
        f = PROJECT / name
        if f.exists():
            for line in f.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith(("OPENAI_", "ANTHROPIC_"))})
    return env


ENV = load_env()
TTS_MODEL = ENV.get("OPENAI_TTS_MODEL") or "gpt-4o-mini-tts"
TTS_VOICE = ENV.get("OPENAI_TTS_VOICE") or "ash"


def tts(text: str, voice: str = None, path: Path = None, fmt: str = "wav") -> bytes:
    key = ENV.get("OPENAI_API_KEY", "")
    if not key:
        raise SystemExit("OPENAI_API_KEY .env.local içinde tanımlı değil.")
    body = json.dumps({"model": TTS_MODEL, "voice": voice or TTS_VOICE, "input": text, "instructions": INSTRUCTIONS,
                       "response_format": fmt}).encode()
    req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:   # anahtar içerebilecek başlıkları değil, yalnızca hata gövdesini göster
        raise RuntimeError(f"TTS hatası {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from None
    if path:
        path.write_bytes(data)
    return data
