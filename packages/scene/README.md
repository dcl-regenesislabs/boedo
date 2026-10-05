# @dcl-editor/scene

The editor's in-engine half: a privileged SDK7 scene (gizmos, picking, the free
camera, the CRDT bridge and the bus to the editor page). See
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) for how it fits with the page.

## Standalone and hosted

The same bundle runs in two places, and decides which at boot from the engine's
live scene list (`src/hosted.ts`):

| | Standalone (desktop) | Hosted (a page that already runs the engine) |
|---|---|---|
| How it starts | the engine's launch-time system scene | spawned at runtime, beside the host's own privileged scene |
| Signal | it is the only privileged scene | another privileged scene is live |
| Login | logs in (previous session, else guest) | never: the host's session is kept |
| Graphics preset, midday clock at boot | applies both | left to the host |
| `rpc` over the bus | all | `getPreviousLogin`, `loginPrevious`, `loginGuest`, `setSetting` are refused |
| Edit target | the scene at the player's parcel | the same, and only a preview scene (`b64-` id) |
| Player back to spawn on Stop | the page's `/move_player_to` console command | the `movePlayerTo` rpc: the SDK call, under the `MovePlayer` permission the host grants (the console command is not registered there) |

The page sends the same messages in both; nothing in the bus protocol says "hosted".
A hosted scene resolves its target once, at boot, so the host starts a fresh instance
(`/reload <hash>`, or kill and spawn) for each project it opens, after the player
has arrived in the project's realm.

## Static export

```bash
npm run export-static -w @dcl-editor/scene
```

Builds the production bundle and writes the realm a host spawns the scene from
(default `packages/web/dist/scene/`):

```
scene/about     names the entity (urn:decentraland:entity:<id>)
scene/<hash>    the entity and each content file, named by content hash
```

`about` names no host: the page fetches the entity and its files, checks them against
their hashes and serves them from its own realm, so one export serves any origin, port or
CDN directory. The entity id depends on the content alone.
