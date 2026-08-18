from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MAX_WIDTH = 1200

IMAGES = [
    "used-tires-bg.png",
    "new-tires-bg.png",
    "changeover-bg.png",
]


def optimize(name):
    source = ASSETS / name
    image = Image.open(source).convert("RGB")
    if image.width > MAX_WIDTH:
        height = round(image.height * (MAX_WIDTH / image.width))
        image = image.resize((MAX_WIDTH, height), Image.Resampling.LANCZOS)

    stem = source.stem
    webp_path = ASSETS / f"{stem}.webp"
    jpg_path = ASSETS / f"{stem}.jpg"
    image.save(webp_path, "WEBP", quality=76, method=6)
    image.save(jpg_path, "JPEG", quality=80, optimize=True, progressive=True)

    original_kb = source.stat().st_size / 1024
    webp_kb = webp_path.stat().st_size / 1024
    jpg_kb = jpg_path.stat().st_size / 1024
    print(
        f"{name}: {image.width}x{image.height} | "
        f"png {original_kb:.0f} KB -> webp {webp_kb:.0f} KB, jpg {jpg_kb:.0f} KB"
    )


def main():
    for name in IMAGES:
        optimize(name)


if __name__ == "__main__":
    main()
