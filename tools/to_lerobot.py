#!/usr/bin/env python3
"""Convert OpenGrasp episode JSON files into a LeRobot-style dataset layout.

Usage:
    python3 tools/to_lerobot.py episode1.json [episode2.json ...] OUT_DIR

Produces:
    OUT_DIR/meta/info.json
    OUT_DIR/meta/episodes.jsonl
    OUT_DIR/data/chunk-000/episode_000000.parquet   (needs pandas + pyarrow)
    ... or episode_000000.jsonl with a warning when parquet support is missing.

The episode files come from the game's "Episode JSON" / dataset download.
Only episodes exported individually carry full frame data.
"""
import json
import sys
from pathlib import Path

FEATURES = {
    "observation.state": {"dtype": "float32", "shape": [6],
                          "names": ["base", "shoulder", "elbow", "wrist_pitch", "wrist_roll", "gripper"]},
    "action": {"dtype": "float32", "shape": [6],
               "names": ["base", "shoulder", "elbow", "wrist_pitch", "wrist_roll", "gripper"]},
    "observation.tip": {"dtype": "float32", "shape": [3], "names": ["x", "y", "z"]},
    "timestamp": {"dtype": "float32", "shape": [1], "names": None},
    "frame_index": {"dtype": "int64", "shape": [1], "names": None},
    "episode_index": {"dtype": "int64", "shape": [1], "names": None},
    "index": {"dtype": "int64", "shape": [1], "names": None},
    "task_index": {"dtype": "int64", "shape": [1], "names": None},
}


def rows_for_episode(ep, ep_idx, task_idx, start_index):
    rows = []
    for i, f in enumerate(ep["frames"]):
        rows.append({
            "observation.state": f["observation.state"],
            "action": f["action"],
            "observation.tip": f["observation.tip"],
            "timestamp": f["timestamp"],
            "frame_index": f["frame_index"],
            "episode_index": ep_idx,
            "index": start_index + i,
            "task_index": task_idx,
        })
    return rows


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    *inputs, out = sys.argv[1:]
    out = Path(out)
    (out / "meta").mkdir(parents=True, exist_ok=True)
    (out / "data" / "chunk-000").mkdir(parents=True, exist_ok=True)

    episodes_meta = []
    tasks = {}
    total_frames = 0
    all_rows = []

    for ep_idx, path in enumerate(inputs):
        ep = json.loads(Path(path).read_text())
        meta = ep["meta"]
        task = meta["task"]
        if task not in tasks:
            tasks[task] = len(tasks)
        rows = rows_for_episode(ep, ep_idx, tasks[task], total_frames)
        all_rows.append(rows)
        episodes_meta.append({
            "episode_index": ep_idx,
            "tasks": [task],
            "length": len(rows),
            "opengrasp": {"quality": meta["quality"], "accepted": meta["accepted"],
                          "success": meta["success"], "points": meta["points"]},
        })
        total_frames += len(rows)

    info = {
        "codebase_version": "opengrasp-v0 (LeRobot-style layout)",
        "robot_type": "so-arm-style-5dof-gripper-sim",
        "total_episodes": len(episodes_meta),
        "total_frames": total_frames,
        "total_tasks": len(tasks),
        "fps": 30,
        "features": FEATURES,
        "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
    }
    (out / "meta" / "info.json").write_text(json.dumps(info, indent=2))
    with open(out / "meta" / "episodes.jsonl", "w") as fh:
        for m in episodes_meta:
            fh.write(json.dumps(m) + "\n")

    try:
        import pandas as pd  # noqa: F401
        have_parquet = True
    except ImportError:
        have_parquet = False

    for ep_idx, rows in enumerate(all_rows):
        stem = out / "data" / "chunk-000" / f"episode_{ep_idx:06d}"
        if have_parquet:
            import pandas as pd
            pd.DataFrame(rows).to_parquet(stem.with_suffix(".parquet"), index=False)
        else:
            with open(stem.with_suffix(".jsonl"), "w") as fh:
                for r in rows:
                    fh.write(json.dumps(r) + "\n")
            print(f"warning: pandas/pyarrow not installed -> wrote {stem.name}.jsonl instead of parquet")

    print(f"wrote {len(episodes_meta)} episodes, {total_frames} frames -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
