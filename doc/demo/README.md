# Demo Video

This directory contains a rebuilt defense demo package for Guide Helper.

Files:
- `build_demo_video.sh` builds the video from current screenshots and diagrams.
- `guide-helper-defense-demo-voiceover.md` contains a synchronized narration script.
- `guide-helper-defense-demo.mp4` is the rendered result.

Build:

```bash
cd /home/jaennil/dev/uni/guide_helper
bash doc/demo/build_demo_video.sh
```

The generated scenes are stored in `doc/demo/build/`, and the final video is written to `doc/demo/guide-helper-defense-demo.mp4`.
