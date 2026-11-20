"""Tarayıcı oynatıcısının yapacağı işin Python karşılığı: taban kare + referans koordinatlı parça bindirme."""
import cv2
import numpy as np

from common import OUT, load_json

PATCHES = OUT / "patches"


class Compositor:
    def __init__(self):
        self.meta = load_json(PATCHES / "patches.json")
        self.W, self.H = self.meta["frame_size"]
        self.cache = {}

    def patch(self, name):
        if name not in self.cache:
            self.cache[name] = cv2.imread(str(PATCHES / name), cv2.IMREAD_UNCHANGED)
        return self.cache[name]

    def warped(self, name, M_from_ref):
        """Parçayı (referans koordinatı) taban karenin koordinatına taşı. Dönen: (bgr float, alpha float)."""
        p = self.patch(name)
        pm = self.meta["patches"][name]
        M = np.array(M_from_ref, np.float64).copy()
        M[:, 2] += M[:, :2] @ np.array([pm["x"], pm["y"]], np.float64)   # parça ofsetini kat
        out = cv2.warpAffine(p, M, (self.W, self.H), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
        return out[..., :3].astype(np.float32), out[..., 3:4].astype(np.float32) / 255.0

    def over(self, base, name, M_from_ref):
        if name is None:
            return base.astype(np.float32)
        rgb, a = self.warped(name, M_from_ref)
        return base.astype(np.float32) * (1 - a) + rgb * a

    def render(self, base, layers, M_from_ref):
        """layers: [(patch_name|None, weight)], ağırlıklar toplamı 1 – canvas'taki crossfade ile eşdeğer."""
        acc = np.zeros(base.shape, np.float32)
        for name, w in layers:
            if w > 0:
                acc += w * self.over(base, name, M_from_ref)
        return np.clip(acc, 0, 255).astype(np.uint8)
