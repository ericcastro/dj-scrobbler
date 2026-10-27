# Recognition decoder fixtures

These files contain generated 440 Hz sine waves, not third-party recordings.
They test that the packaged FFmpeg source builds can decode the AAC/MP4 and
Opus/WebM formats used by the recognition audio pipeline.

Each fixture is 1.5 seconds long. `scripts/test-media-runtime.js` decodes the
first second into mono 16 kHz float PCM and verifies its length and signal level.

Generation:

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1.5 -c:a aac recognition-aac.m4a
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1.5 -c:a libopus recognition-opus.webm
```
