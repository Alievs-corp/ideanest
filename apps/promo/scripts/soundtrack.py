import json
import re
import subprocess
import wave
from pathlib import Path

import numpy as np

from prepare_media import MEDIA, ROOT, ffmpeg

SR = 48000
TIMELINE = json.loads((ROOT / "src" / "timeline.json").read_text(encoding="utf-8"))
FPS = TIMELINE["fps"]
BEAT = 60 / TIMELINE["bpm"]
BAR = BEAT * 4
LENGTH = TIMELINE["durationInFrames"] / FPS
N = int(LENGTH * SR)
RNG = np.random.default_rng(7)

CHORDS = {
    "Am": (45, [57, 60, 64, 67, 71]),
    "F": (41, [53, 57, 60, 64, 67]),
    "C": (48, [55, 60, 64, 67, 74]),
    "G": (43, [55, 59, 62, 64, 69]),
}
PROGRESSION = ["Am", "F", "C", "G", "Am", "F", "C", "G", "Am", "F", "C", "G", "Am", "F", "C"]
PENTATONIC = [81, 84, 86, 88, 91, 93, 96, 98]


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def frames(f: int) -> float:
    return f / FPS


def band(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    mask = np.clip((freqs - lo * 0.8) / (lo * 0.2 + 1e-9), 0, 1) * np.clip((hi * 1.25 - freqs) / (hi * 0.25), 0, 1)
    return np.fft.irfft(spec * mask, len(x))


def place(track: np.ndarray, t: float, sound: np.ndarray, gain: float = 1.0) -> None:
    start = int(t * SR)
    if start >= len(track):
        return
    end = min(len(track), start + len(sound))
    track[start:end] += sound[: end - start] * gain


def mix(*sounds: np.ndarray) -> np.ndarray:
    out = np.zeros(max(len(x) for x in sounds))
    for x in sounds:
        out[: len(x)] += x
    return out


def env_exp(n: int, rate: float) -> np.ndarray:
    return np.exp(-np.arange(n) / SR * rate)


def saw(freq: float, n: int, phase: float = 0.0, harmonics: int = 12) -> np.ndarray:
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, harmonics + 1):
        if freq * k > 9000:
            break
        out += np.sin(2 * np.pi * freq * k * t + phase * k) / k**1.5
    return out


def kick(length: float = 0.45) -> np.ndarray:
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 46 + 84 * np.exp(-t * 32)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * env_exp(n, 7)
    click = band(RNG.normal(0, 1, n), 2000, 9000) * env_exp(n, 400) * 0.25
    return body + click


def hat(open_: bool = False) -> np.ndarray:
    n = int((0.35 if open_ else 0.08) * SR)
    return band(RNG.normal(0, 1, n), 7000, 16000) * env_exp(n, 10 if open_ else 70) * 0.35


def clap() -> np.ndarray:
    n = int(0.3 * SR)
    noise = band(RNG.normal(0, 1, n), 900, 5000)
    out = np.zeros(n)
    for offset in (0, 0.011, 0.022):
        s = int(offset * SR)
        out[s:] += noise[: n - s] * env_exp(n - s, 22)
    return out * 0.4


def pluck(midi: float, length: float = 0.6, rate: float = 12) -> np.ndarray:
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(midi)
    tone = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    return tone * env_exp(n, rate)


def bell(freq: float, length: float = 2.4) -> np.ndarray:
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, rate in ((1, 1.0, 2.2), (2.0, 0.45, 3.5), (2.76, 0.35, 4.5), (5.4, 0.15, 7)):
        out += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t * rate)
    attack = np.clip(t / 0.004, 0, 1)
    return out * attack


def whoosh(length: float = 0.5) -> np.ndarray:
    n = int(length * SR)
    window = np.sin(np.linspace(0, np.pi, n)) ** 2
    return band(RNG.normal(0, 1, n), 250, 3200) * window * 0.32


def air(length: float = 0.35) -> np.ndarray:
    n = int(length * SR)
    window = np.sin(np.linspace(0, np.pi, n)) ** 2
    return band(RNG.normal(0, 1, n), 4500, 15000) * window * 0.18


def riser(length: float) -> np.ndarray:
    n = int(length * SR)
    t = np.arange(n) / SR
    ramp = (t / length) ** 2
    f = 220 * 4 ** (t / length)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    noise = band(RNG.normal(0, 1, n), 1500, 12000) * 0.5
    return (tone + noise) * ramp


def impact() -> np.ndarray:
    n = int(1.8 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (38 + 30 * np.exp(-t * 8)) * t) * np.exp(-t * 2.6)
    burst = band(RNG.normal(0, 1, n), 60, 900) * np.exp(-t * 9) * 0.6
    return mix(boom + burst, kick() * 0.8)


def music() -> tuple[np.ndarray, np.ndarray]:
    left = np.zeros(N)
    right = np.zeros(N)
    drop = frames(TIMELINE["cues"]["reveal"])
    riser_from = drop - 1.5

    for i, name in enumerate(PROGRESSION):
        root, notes = CHORDS[name]
        t0 = i * BAR
        n = int((BAR + 0.6) * SR)
        tt = np.arange(n) / SR
        envelope = np.clip(tt / 0.35, 0, 1) * np.clip((BAR + 0.6 - tt) / 0.6, 0, 1)
        brightness = 7 if t0 < drop else 10
        pad_l = mix(*(saw(hz(m), n, 0.0, brightness) for m in notes))
        pad_r = mix(*(saw(hz(m) * 1.004, n, 1.3, brightness) for m in notes))
        level = 0.05 if i == 0 else 0.06
        if 22 <= t0 < 26:
            level = 0.075
        place(left, t0, pad_l * envelope, level)
        place(right, t0, pad_r * envelope, level)

        if t0 >= 2 and t0 < 26:
            for step in range(8):
                ts = t0 + step * BEAT / 2
                if riser_from + 0.3 < ts < drop:
                    continue
                if ts >= 22 and step % 4:
                    continue
                note = root + (12 if step % 4 == 3 else 0)
                b = pluck(note, 0.42, 9) * 0.2
                place(left, ts, b)
                place(right, ts, b)

    kicks: list[float] = []
    t = 2.0
    while t < 26.0:
        in_gap = riser_from + 0.3 < t < drop
        halftime = t >= 22.0
        if not in_gap and (not halftime or abs((t - 22.0) % (BEAT * 2)) < 1e-6):
            kicks.append(t)
        t = round(t + BEAT, 6)
    for k in kicks:
        place(left, k, kick(), 0.55)
        place(right, k, kick(), 0.55)

    t = 4.0
    while t < 22.0:
        ts = t + BEAT / 2
        if not (riser_from + 0.3 < ts < drop):
            h = hat(open_=ts > drop)
            place(left, ts, h, 0.55)
            place(right, ts, h, 0.45)
        t = round(t + BEAT, 6)

    t = 8.0 + BEAT
    while t < 22.0:
        if not (riser_from + 0.3 < t < drop):
            c = clap()
            place(left, t, c, 0.5)
            place(right, t, c, 0.5)
        t = round(t + BEAT * 2, 6)

    pump = np.ones(N)
    for k in kicks:
        s = int(k * SR)
        n = min(N - s, int(0.4 * SR))
        if n > 0:
            pump[s : s + n] = np.minimum(pump[s : s + n], 1 - 0.45 * env_exp(n, 9))
    left *= pump
    right *= pump

    fade_from = 28.4
    tail = np.clip((LENGTH - np.arange(N) / SR) / (LENGTH - fade_from), 0, 1)
    tail = np.where(np.arange(N) / SR < fade_from, 1.0, tail)
    return left * tail, right * tail


def effects() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    left = np.zeros(N)
    right = np.zeros(N)
    duck = np.ones(N)
    avatar = 0
    for cue in TIMELINE["sfx"]:
        t = frames(cue["f"])
        kind = cue["kind"]
        pan = 0.0
        if kind == "ignite":
            n = int(0.9 * SR)
            tt = np.arange(n) / SR
            sound = mix(np.sin(2 * np.pi * np.cumsum(700 + 900 * tt) / SR) * np.sin(np.linspace(0, np.pi, n)) * 0.12, air(0.9))
        elif kind == "tick":
            sound = pluck(93, 0.12, 60) * 0.06
        elif kind == "tap":
            sound = mix(pluck(84, 0.12, 70) * 0.18, pluck(48, 0.15, 40) * 0.12)
        elif kind == "whoosh":
            sound = whoosh()
        elif kind == "air":
            sound = air()
        elif kind == "lift":
            n = int(0.3 * SR)
            tt = np.arange(n) / SR
            sound = mix(np.sin(2 * np.pi * np.cumsum(300 + 900 * tt) / SR) * np.sin(np.linspace(0, np.pi, n)) * 0.08, air(0.3))
        elif kind == "avatar":
            sound = pluck(PENTATONIC[avatar % len(PENTATONIC)], 0.5, 13) * 0.09
            pan = -0.6 + 1.2 * (avatar % len(PENTATONIC)) / (len(PENTATONIC) - 1)
            avatar += 1
        elif kind == "riser":
            length = frames(TIMELINE["cues"]["reveal"]) - t
            sound = riser(length) * 0.35
        elif kind == "impact":
            sound = impact() * 0.7
        elif kind == "chime":
            sound = bell(hz(84)) * 0.12
        elif kind == "cta":
            stab = mix(*(pluck(m, 1.6, 2.5) * 0.08 for m in (60, 64, 67, 72)))
            sound = mix(kick() * 0.6, stab, bell(hz(79), 2.6) * 0.1)
        else:
            raise ValueError(f"unknown sfx kind {kind}")
        place(left, t, sound, 1 - max(0, pan))
        place(right, t, sound, 1 + min(0, pan))
        if kind in ("tap", "impact", "chime", "cta"):
            s = int(t * SR)
            n = min(N - s, int(0.45 * SR))
            if n > 0:
                curve = 1 - 0.37 * np.minimum(1, np.arange(n) / (0.03 * SR)) * env_exp(n, 6)
                duck[s : s + n] = np.minimum(duck[s : s + n], curve)
    return left, right, duck


def write_wav(path: Path, left: np.ndarray, right: np.ndarray) -> None:
    stereo = np.stack([left, right], axis=1)
    peak = np.max(np.abs(stereo)) or 1.0
    pcm = (stereo / peak * 0.7 * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def loudnorm(src: Path, out: Path, target: float = -14.0, peak: float = -1.5) -> str:
    probe = subprocess.run(
        [ffmpeg(), "-hide_banner", "-i", str(src), "-af", f"loudnorm=I={target}:TP={peak}:LRA=7:print_format=json", "-f", "null", "-"],
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    stats = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", probe, re.S).group(0))
    chain = (
        f"loudnorm=I={target}:TP={peak}:LRA=7:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}"
        f":measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true"
    )
    subprocess.run(
        [ffmpeg(), "-v", "error", "-y", "-i", str(src), "-af", chain, "-ar", str(SR), "-c:a", "pcm_s16le", str(out)],
        check=True,
    )
    return chain


def main() -> None:
    ml, mr = music()
    sl, sr_, duck = effects()
    left = ml * duck + sl
    right = mr * duck + sr_
    raw = MEDIA / "audio" / "soundtrack.raw.wav"
    out = MEDIA / "audio" / "soundtrack.wav"
    raw.parent.mkdir(parents=True, exist_ok=True)
    write_wav(raw, left, right)
    loudnorm(raw, out)
    raw.unlink()
    print("soundtrack", out.name, f"{LENGTH:.1f}s")


if __name__ == "__main__":
    main()
