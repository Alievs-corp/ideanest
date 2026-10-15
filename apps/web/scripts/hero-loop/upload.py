"""Upload the hero scene loops that render.mjs wrote to a new version folder of the media bucket.

Credentials are read from a two-line file (access key, then secret key) whose path is in
PROMO_S3_CREDENTIALS, as for the promo film (apps/promo/scripts/publish.py), and are never
printed. The folder is versioned, so the files are immutable and cached for a year: after the
upload, set HERO_LOOP_VERSION in packages/messages/src/hero-loop.ts to the same number.

    PROMO_S3_CREDENTIALS=<file> python scripts/hero-loop/upload.py 2 <folder render.mjs wrote>
"""

import os
import sys
from pathlib import Path

ENDPOINT = "https://fsn1.your-objectstorage.com"
BUCKET = "ideyanest-media"
PREFIX = "media/promo/hero"
KINDS = {".mp4": "video/mp4", ".webp": "image/webp"}
CUTS = ("desktop", "tablet", "phone")


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
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    version, folder = sys.argv[1], Path(sys.argv[2])
    files = [folder / f"hero-scene-{cut}{suffix}" for cut in CUTS for suffix in KINDS]
    missing = [path.name for path in files if not path.exists()]
    if missing:
        sys.exit(f"missing in {folder}: {', '.join(missing)}; run render.mjs first")
    s3 = client()
    for path in files:
        key = f"{PREFIX}/v{version}/{path.name}"
        s3.upload_file(
            str(path), BUCKET, key,
            ExtraArgs={"ContentType": KINDS[path.suffix], "CacheControl": "public, max-age=31536000, immutable"},
        )
        print("uploaded", key)
    print(f"now set HERO_LOOP_VERSION = {version} in packages/messages/src/hero-loop.ts")


if __name__ == "__main__":
    main()
