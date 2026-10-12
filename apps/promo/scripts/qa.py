import re
import subprocess
import sys
from pathlib import Path

from prepare_media import ROOT, ffmpeg

FLASH_SWING = 25.5
MAX_FLASHES_PER_SECOND = 3


def probe(path: Path) -> str:
    info = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    return "\n".join(line.strip() for line in info.splitlines() if re.search(r"Duration|Stream", line))


def loudness(path: Path) -> tuple[float, float]:
    log = subprocess.run(
        [ffmpeg(), "-hide_banner", "-i", str(path), "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    integrated = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1])
    peak = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", log)[-1])
    return integrated, peak


def flashes(path: Path, fps: int = 60) -> tuple[int, int]:
    log = subprocess.run(
        [ffmpeg(), "-v", "error", "-i", str(path), "-vf", "scale=96:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stdout
    y = [float(v) for v in re.findall(r"YAVG=([\d.]+)", log)]
    swings, start, sign = [], 0, 0
    for i in range(1, len(y)):
        s = (y[i] > y[i - 1]) - (y[i] < y[i - 1])
        if s != sign:
            if sign and abs(y[i - 1] - y[start]) >= FLASH_SWING:
                swings.append(i - 1)
            start, sign = i - 1, s
    if sign and abs(y[-1] - y[start]) >= FLASH_SWING:
        swings.append(len(y) - 1)
    worst = max((sum(1 for t in swings if s <= t < s + fps) // 2 for s in range(len(y))), default=0)
    return len(swings), worst


def sheets(path: Path, out: Path) -> None:
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-i", str(path), "-vf", "fps=2,scale=216:-1,tile=10x6", "-frames:v", "1", str(out / f"{path.stem}.sheet.png")], check=True)
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-i", str(path), "-vf", "fps=12/30,scale=540:-1", str(out / f"{path.stem}.pause-%02d.png")], check=True)


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "out" / "spark-to-nest-9x16-az.mp4"
    qa = path.parent / "qa"
    qa.mkdir(exist_ok=True)
    print(probe(path))
    integrated, peak = loudness(path)
    print(f"loudness {integrated} LUFS, true peak {peak} dBFS")
    swings, worst = flashes(path)
    print(f"flash {swings} luminance swings, worst {worst} flashes per second")
    sheets(path, qa)
    print(f"sheets in {qa}")
    failed = []
    if not -15.0 <= integrated <= -13.0:
        failed.append("loudness")
    if peak > -1.0:
        failed.append("true peak")
    if worst > MAX_FLASHES_PER_SECOND:
        failed.append("flash")
    print("FAILED: " + ", ".join(failed) if failed else "gates passed (contact sheet still to be read by eye)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
