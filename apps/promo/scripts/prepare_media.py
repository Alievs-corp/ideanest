import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "public" / "media"


def ffmpeg() -> str:
    explicit = os.environ.get("FFMPEG")
    if explicit:
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg not found: set FFMPEG, put ffmpeg on PATH, or pip install imageio-ffmpeg")


def run(*args: str) -> None:
    subprocess.run([ffmpeg(), "-v", "error", "-y", *args], check=True)


def main() -> None:
    manifest = json.loads((ROOT / "captures.json").read_text(encoding="utf-8"))
    source = Path(os.environ.get("PROMO_CAPTURES", os.path.expanduser(manifest["source"])))
    if not source.is_dir():
        sys.exit(f"captures folder not found: {source} (set PROMO_CAPTURES)")

    for folder in ("clips", "stills", "crops", "fx", "audio"):
        (MEDIA / folder).mkdir(parents=True, exist_ok=True)

    for clip in manifest["clips"]:
        out = MEDIA / "clips" / f"{clip['id']}.mp4"
        run(
            "-ss", str(clip["from"]), "-to", str(clip["to"]), "-i", str(source / clip["file"]),
            "-vf", "fps=60,format=yuv420p", "-an",
            "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-g", "30",
            "-movflags", "+faststart", str(out),
        )
        print("clip", out.name)

    for still in manifest["stills"]:
        out = MEDIA / "stills" / f"{still['id']}.png"
        run("-ss", str(still["t"]), "-i", str(source / still["file"]), "-frames:v", "1", str(out))
        print("still", out.name)

    for crop in manifest["crops"]:
        src = MEDIA / "stills" / f"{crop['still']}.png"
        out = MEDIA / "crops" / f"{crop['id']}.png"
        run("-i", str(src), "-vf", f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']}", str(out))
        print("crop", out.name)

    write_grain(MEDIA / "fx" / "grain.png")
    print("grain grain.png")


def write_grain(out: Path, size: int = 256) -> None:
    import numpy as np

    rng = np.random.default_rng(2026)
    noise = np.clip(rng.normal(128, 64, (size, size)), 0, 255).astype(np.uint8)
    subprocess.run(
        [ffmpeg(), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{size}x{size}", "-i", "-", str(out)],
        input=noise.tobytes(),
        check=True,
    )


if __name__ == "__main__":
    main()
