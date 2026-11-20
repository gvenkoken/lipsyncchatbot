"""ADIM 1 – ffprobe ile teknik bilgiler -> out/probe.json"""
import json
from common import FFPROBE, VIDEO, OUT, run, save_json

raw = json.loads(run([FFPROBE, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(VIDEO)]))
v = next(s for s in raw["streams"] if s["codec_type"] == "video")
a = next((s for s in raw["streams"] if s["codec_type"] == "audio"), None)
num, den = map(int, v["avg_frame_rate"].split("/"))
info = {
    "file": str(VIDEO.name),
    "width": v["width"], "height": v["height"],
    "fps": num / den, "frames": int(v.get("nb_frames", 0)),
    "duration_s": float(raw["format"]["duration"]),
    "video_codec": f'{v["codec_name"]} ({v.get("profile","")})', "pix_fmt": v.get("pix_fmt"),
    "video_bitrate_kbps": round(int(v.get("bit_rate", 0)) / 1000),
    "total_bitrate_kbps": round(int(raw["format"]["bit_rate"]) / 1000),
    "audio_codec": a and f'{a["codec_name"]} ({a.get("profile","")})',
    "audio_sample_rate": a and int(a["sample_rate"]), "audio_channels": a and a["channels"],
    "audio_bitrate_kbps": a and round(int(a.get("bit_rate", 0)) / 1000),
    "bits_per_pixel": round(int(v.get("bit_rate", 0)) / (v["width"] * v["height"] * num / den), 4),
}
save_json(info, OUT / "probe.json")
for k, val in info.items():
    print(f"{k:22s} {val}")
