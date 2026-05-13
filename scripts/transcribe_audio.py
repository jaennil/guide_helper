#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from faster_whisper import WhisperModel

DEFAULT_PROMPT = (
    "Защита выпускной квалификационной работы. "
    "Московский Политех. Прикладная информатика. "
    "ВКР, актуальность, цель, задачи, объект, предмет, требования, "
    "функциональные требования, нефункциональные требования, "
    "архитектура, база данных, интерфейс, тестирование, апробация, "
    "экономическая эффективность, комиссия, научный руководитель."
)


def fmt_ts(seconds: float, sep: str = ",") -> str:
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default="ru")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--initial-prompt", default=DEFAULT_PROMPT)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = args.input.stem

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    segments_iter, info = model.transcribe(
        str(args.input),
        language=args.language,
        beam_size=args.beam_size,
        initial_prompt=args.initial_prompt,
        condition_on_previous_text=False,
        temperature=[0.0, 0.2, 0.4],
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 300},
    )
    segments = [
        {
            "id": i,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }
        for i, segment in enumerate(segments_iter, start=1)
    ]

    (args.output_dir / f"{stem}.txt").write_text(
        "\n".join(f"[{fmt_ts(s['start'], '.')}] {s['text']}" for s in segments) + "\n",
        encoding="utf-8",
    )
    (args.output_dir / f"{stem}.srt").write_text(
        "\n\n".join(
            f"{s['id']}\n{fmt_ts(s['start'])} --> {fmt_ts(s['end'])}\n{s['text']}"
            for s in segments
        )
        + "\n",
        encoding="utf-8",
    )
    (args.output_dir / f"{stem}.json").write_text(
        json.dumps(
            {
                "input": str(args.input),
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "segments": segments,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
