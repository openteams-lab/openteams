from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter


SOURCE = Path(
    r"E:\workspace\projectSS\agents-chatgroup\docs\logos\openteams_black_outline.png"
)
REFERENCE = Path(
    r"E:\workspace\projectSS\agents-chatgroup\frontend\public\openteams-brand-logo.png"
)
OUTPUT = Path(
    r"E:\workspace\projectSS\agents-chatgroup\docs\logos\openteams_black_outline_refined.png"
)
BLACK_OUTPUT = Path(
    r"E:\workspace\projectSS\agents-chatgroup\docs\logos\openteams_black_solid.png"
)


def to_mask(data: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(data * 255.0, 0, 255).astype(np.uint8), mode="L")


def premultiplied_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    rgb = rgba[..., :3]
    alpha = rgba[..., 3:4]
    premultiplied = rgb * alpha

    rgb_image = Image.fromarray(
        np.clip(premultiplied * 255.0, 0, 255).astype(np.uint8), mode="RGB"
    )
    alpha_image = Image.fromarray(
        np.clip(alpha[..., 0] * 255.0, 0, 255).astype(np.uint8), mode="L"
    )

    rgb_small = rgb_image.resize(size, Image.Resampling.LANCZOS)
    alpha_small = alpha_image.resize(size, Image.Resampling.LANCZOS)

    rgb_arr = np.asarray(rgb_small, dtype=np.float32) / 255.0
    alpha_arr = np.asarray(alpha_small, dtype=np.float32) / 255.0
    safe_alpha = np.where(alpha_arr > 1e-6, alpha_arr, 1.0)
    restored = rgb_arr / safe_alpha[..., None]
    restored[alpha_arr <= 1e-6] = 0.0

    out = np.dstack(
        [
            np.clip(restored * 255.0, 0, 255).astype(np.uint8),
            np.clip(alpha_arr * 255.0, 0, 255).astype(np.uint8),
        ]
    )
    return Image.fromarray(out, mode="RGBA")


def load_reference() -> tuple[Image.Image, tuple[int, int]]:
    target_size = Image.open(SOURCE).convert("RGBA").size
    if REFERENCE.exists():
        return Image.open(REFERENCE).convert("RGBA"), target_size
    return Image.open(SOURCE).convert("RGBA"), target_size


def build_masks(reference: Image.Image) -> tuple[Image.Image, Image.Image]:
    rgba = np.asarray(reference.convert("RGBA"), dtype=np.float32) / 255.0
    rgb = rgba[..., :3]
    alpha = rgba[..., 3]

    luminance = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    saturation = rgb.max(axis=2) - rgb.min(axis=2)

    white_score = np.clip((luminance - 0.72) / 0.28, 0.0, 1.0)
    white_score *= np.clip((0.18 - saturation) / 0.18, 0.0, 1.0)
    white_score = np.maximum(white_score, np.clip((luminance - 0.9) / 0.08, 0.0, 1.0))
    white_score *= alpha

    fill_mask = to_mask(white_score)
    fill_mask = fill_mask.filter(ImageFilter.GaussianBlur(radius=0.9))
    fill_mask = fill_mask.filter(ImageFilter.MaxFilter(size=3))
    fill_mask = ImageChops.multiply(fill_mask, to_mask(alpha))

    silhouette_mask = to_mask(alpha)
    silhouette_mask = silhouette_mask.filter(ImageFilter.GaussianBlur(radius=0.35))

    return silhouette_mask, fill_mask


def compose_logo(silhouette_mask: Image.Image, fill_mask: Image.Image) -> Image.Image:
    black = Image.new("RGBA", silhouette_mask.size, (0, 0, 0, 0))
    black.putalpha(silhouette_mask)

    white = Image.new("RGBA", fill_mask.size, (255, 255, 255, 0))
    white.putalpha(fill_mask)

    merged = Image.alpha_composite(black, white)
    return merged.filter(ImageFilter.UnsharpMask(radius=1.1, percent=120, threshold=2))


def smooth_black_outline() -> Path:
    reference, target_size = load_reference()
    silhouette_mask, fill_mask = build_masks(reference)
    high_res = compose_logo(silhouette_mask, fill_mask)
    result = premultiplied_resize(high_res, target_size)
    result.save(OUTPUT)
    return OUTPUT


def generate_solid_black() -> Path:
    reference, target_size = load_reference()
    silhouette_mask, _ = build_masks(reference)
    solid = Image.new("RGBA", silhouette_mask.size, (0, 0, 0, 0))
    solid.putalpha(silhouette_mask)
    result = premultiplied_resize(solid, target_size)
    result.save(BLACK_OUTPUT)
    return BLACK_OUTPUT


if __name__ == "__main__":
    print(smooth_black_outline())
    print(generate_solid_black())
