"""Cut the web, phone and poster files for each language and upload them to the media bucket.

Credentials are read from a two-line file (access key, then secret key) whose path is in
PROMO_S3_CREDENTIALS, and are never printed. Uploads go to a versioned folder, so the files are
immutable and served with a year-long cache.

    PROMO_S3_CREDENTIALS=<file> python scripts/publish.py 2 az en ru
"""

import mimetypes
import os
import subprocess
import sys
from pathlib import Path

from prepare_media import ROOT, ffmpeg

ENDPOINT = "https://fsn1.your-objectstorage.com"
BUCKET = "ideyanest-media"
PREFIX = "media/promo"
OUT = ROOT / "out"
PUBLISH = OUT / "publish"
POSTER_AT = 5.5


def run(*args: str) -> None:
    subprocess.run([ffmpeg(), "-v", "error", "-y", *args], check=True)


def cuts(lang: str) -> list[Path]:
    name = f"spark-to-nest-9x16-{lang}"
    web = OUT / f"{name}.mp4"
    if not web.exists():
        sys.exit(f"{web} is missing: run `pnpm render {lang}` first")
    PUBLISH.mkdir(parents=True, exist_ok=True)
    phone = PUBLISH / f"{name}-720.mp4"
    poster = PUBLISH / f"{name}.jpg"
    run(
        "-i", str(web), "-vf", "scale=720:1280:flags=lanczos,format=yuv420p",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-b:v", "4M", "-maxrate", "5M", "-bufsize", "8M",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(phone),
    )
    run("-ss", str(POSTER_AT), "-i", str(web), "-frames:v", "1", "-q:v", "3", "-vf", "scale=720:-1", str(poster))
    return [web, phone, poster]


def client():
    import boto3
    from botocore.config import Config

    source = os.environ.get("PROMO_S3_CREDENTIALS")
    if not source:
        sys.exit("set PROMO_S3_CREDENTIALS to a file with the access key and the secret key on two lines")
    lines = [line.strip() for line in Path(source).read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(lines) < 2:
        sys.exit("the credentials file needs the access key on line 1 and the secret key on line 2")
    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        region_name="fsn1",
        aws_access_key_id=lines[0],
        aws_secret_access_key=lines[1],
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    version, languages = sys.argv[1], sys.argv[2:]
    s3 = client()
    for lang in languages:
        for path in cuts(lang):
            key = f"{PREFIX}/v{version}/{path.name}"
            kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            s3.upload_file(
                str(path), BUCKET, key,
                ExtraArgs={"ContentType": kind, "CacheControl": "public, max-age=31536000, immutable"},
            )
            print(f"uploaded {key} ({path.stat().st_size / 1e6:.1f} MB, {kind})")


if __name__ == "__main__":
    main()
