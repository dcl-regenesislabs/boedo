# Sky Lantern Run

`scene.zip` is a blank scene built by the web editor's assistant from `prompt.txt`, exported
unmodified. It uses Run Progress, Health & Respawn, Trigger Area and UI Theme, plus two
custom scripts for bobbing and sunset. The replays check it with real player physics and no
model calls.

## Replay

1. Import `scene.zip` into the web editor (local service, Chromium with CDP, 1440×900).
2. Press Play, then **Restart run** if the timer or counters are not zero: Stop/Play can keep
   the server's previous attempt. Leave the game HUD visible.
3. From the repository root:

```sh
npm run validate:preview -w @dcl-editor/web -- --cdp http://127.0.0.1:9222 --scenario packages/web/validate/fixtures/sky-lantern-run-acceptance/complete.json
npm run validate:preview -w @dcl-editor/web -- --cdp http://127.0.0.1:9222 --scenario packages/web/validate/fixtures/sky-lantern-run-acceptance/restart.json
npm run validate:preview -w @dcl-editor/web -- --cdp http://127.0.0.1:9222 --scenario packages/web/validate/fixtures/sky-lantern-run-acceptance/restart-running.json
```

`complete.json` collects five orbs, visits all three checkpoints, falls and respawns at
checkpoints one and three, and completes the run. `restart.json` checks **Run again** after
completion; `restart-running.json` checks **Restart** during an attempt. Repeated engine
screenshots need the Bevy screenshot fix (robtfm/bevy#7).

## Repeat the generation

In another blank scene, with the assistant panel open:

```sh
npm run validate:preview -w @dcl-editor/web -- --cdp http://127.0.0.1:9222 --prompt packages/web/validate/fixtures/sky-lantern-run-acceptance/prompt.txt --timeout 1800
```

A finished turn is not acceptance: play the new course, adapting replay coordinates to its
geometry.
