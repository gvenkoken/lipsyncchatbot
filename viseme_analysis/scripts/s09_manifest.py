"""ADIM 9 – Tarayıcı oynatıcısı için out/manifest.json
Tüm yollar out/ klasörüne göredir. Çizim (canvas 2D):
  1) idle karesini çiz (playback sırasına göre)
  2) her aktif viseme parçası için: ctx.setTransform(...idle_frame.from_ref); ctx.globalAlpha = ağırlık;
     ctx.drawImage(patch, patch.x, patch.y)
  Not: crossfade için iki parçayı ayrı ayrı tabana bindirip ağırlıklı karıştırmak en doğrusudur
  (ör. offscreen canvas A ve B, sonra globalAlpha ile birleştirme). Tek katmanda üst üste çizmek de
  kabul edilebilir yaklaşımdır (feather alanlar örtüştüğü için fark küçüktür).
"""
import pandas as pd

from common import OUT, VISEMES, load_json, save_json

pj = load_json(OUT / "patches" / "patches.json")
idle = load_json(OUT / "idle" / "idle.json")
st = load_json(OUT / "stability.json")
cov = pd.read_csv(OUT / "viseme_coverage.csv").set_index("viseme")


def m6(M):   # 2x3 -> canvas setTransform(a, b, c, d, e, f)
    return [M[0][0], M[1][0], M[0][1], M[1][1], M[0][2], M[1][2]]


visemes = {}
for v in VISEMES:
    ps = sorted([(k, p) for k, p in pj["patches"].items() if p["viseme"] == v], key=lambda kp: kp[1]["n"])
    visemes[v] = dict(
        patches=[dict(file=f"patches/{k}", x=p["x"], y=p["y"], w=p["w"], h=p["h"], src_frame=p["src_frame"],
                      src_time=p["src_time"], src_word=p["word"]) for k, p in ps],
        default=0,
        frames_in_video=int(cov.loc[v, "frames"]) if v in cov.index else 0,
        passages_in_video=int(cov.loc[v, "passages"]) if v in cov.index else 0,
    )
visemes["SIL"]["draw"] = "base" if idle["mode"] == "strict" else "patch"
visemes["KG"]["coarticulate"] = "Komşu (tercihen sonraki) ünlünün parçasını kullan; yoksa KG parçası."

manifest = dict(
    version=1,
    frame_size=pj["frame_size"], fps=25,
    reference=dict(frame=st["reference_frame"], time_s=st["reference_time_s"], image="reference_frame.png",
                   note="Tüm parçalar bu karenin koordinat sistemindedir (benzerlik dönüşümüyle hizalanmış)."),
    crossfade_ms=60, feather_px=pj["feather_px"],
    letter_to_viseme={"SIL": "sessizlik", "PBM": "p b m", "FV": "f v", "DNT": "t d n l r", "SZ": "s z",
                      "SH": "ş ç c j", "KG": "k g h y", "A": "a", "E": "e", "I": "i ı", "O": "o ö", "U": "u ü",
                      "ğ": "önceki ünlüyü uzatır"},
    visemes=visemes,
    idle=dict(
        video="idle/idle_loop.mp4", video_pingpong="idle/idle_loop_pingpong.mp4",
        frames=[dict(file=f"idle/frames/{f}", src_frame=s, from_ref=m6(Mf), to_ref=m6(Mt))
                for f, s, Mf, Mt in zip(idle["frames"], idle["source_frames"], idle["affine_from_ref"], idle["affine_to_ref"])],
        playback="pingpong", playback_order=idle["playback_order_pingpong"],
        mouth="closed" if idle["mode"] == "strict" else "any (SIL parçası bindir)",
        has_blink=bool(idle["candidates"][idle["mode"]]["has_blink"]),
        loop_jump=dict(pixel_mae=idle["loop_jump_pixel_mae"], typical_consecutive=idle["consecutive_pixel_mae_median"]),
        transform_note="from_ref = canvas setTransform(a,b,c,d,e,f): parçayı referans koordinatından bu idle karesine taşır.",
    ),
)
save_json(manifest, OUT / "manifest.json")
print("Yazıldı: manifest.json  viseme:", len(visemes), " idle kare:", len(manifest["idle"]["frames"]))
