#!/usr/bin/env python3
import argparse


def stamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--output", required=True)
    parser.add_argument("--words-per-caption", type=int, default=3)
    args = parser.parse_args()

    words = args.text.split()
    if not words:
        raise SystemExit("voiceover text is empty")

    chunk_size = max(1, min(args.words_per_caption, 5))
    chunks = [words[i:i + chunk_size] for i in range(0, len(words), chunk_size)]
    duration = max(args.duration, 0.5)
    total_words = len(words)
    seen = 0

    with open(args.output, "w", encoding="utf-8") as handle:
        for index, chunk in enumerate(chunks, start=1):
            start = duration * (seen / total_words)
            seen += len(chunk)
            end = duration * (seen / total_words)
            handle.write(f"{index}\n{stamp(start)} --> {stamp(end)}\n{' '.join(chunk)}\n\n")


if __name__ == "__main__":
    main()
