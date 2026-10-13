// Regenerates src/sounds/ from Kenney's audio packs (CC0): each pick becomes <name>.mp3 (mono, trimmed,
// loudness-normalised; a loop is crossfaded at the wrap), its description, length
// and loop flag in properties.json, plus CREDITS.md.
// Run from the repo root: node packages/ui/scripts/pack-sounds.mjs (needs unzip and ffmpeg with libmp3lame;
// FFMPEG=/path/to/ffmpeg overrides, else Homebrew's ffmpeg@6, else the one on PATH).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKS = {
  'interface-sounds': 'Interface Sounds', 'impact-sounds': 'Impact Sounds', 'digital-audio': 'Digital Audio',
  'rpg-audio': 'RPG Audio', 'sci-fi-sounds': 'Sci-fi Sounds', 'music-jingles': 'Music Jingles'
}
// name: [pack, file inside the zip's Audio/, what it is, loop]
const PICKS = {
  coin: ['digital-audio', 'highUp.ogg', 'bright rising blip: coin or collectible picked up'],
  gem: ['interface-sounds', 'glass_001.ogg', 'glassy chime: gem, crystal or rare item picked up'],
  'power-up': ['digital-audio', 'powerUp3.ogg', 'rising synth sweep: power-up or boost'],
  point: ['interface-sounds', 'confirmation_001.ogg', 'short confirm blip: point scored, checkpoint, correct'],
  'countdown-tick': ['digital-audio', 'tone1.ogg', 'single beep: each second of a countdown'],
  start: ['digital-audio', 'threeTone2.ogg', 'three rising tones: go, round start'],
  win: ['music-jingles', '8-Bit jingles/jingles_NES12.ogg', 'rising 8-bit fanfare: win, level complete'],
  lose: ['music-jingles', '8-Bit jingles/jingles_NES11.ogg', 'falling 8-bit jingle: lose, game over'],
  'time-up': ['digital-audio', 'zapThreeToneDown.ogg', 'falling buzz: time up, round over'],
  click: ['interface-sounds', 'click_001.ogg', 'soft click: button press'],
  open: ['interface-sounds', 'open_001.ogg', 'short rise: panel or menu opens'],
  close: ['interface-sounds', 'close_001.ogg', 'short fall: panel or menu closes'],
  error: ['interface-sounds', 'error_006.ogg', 'low buzz: wrong, denied, locked'],
  jump: ['digital-audio', 'phaseJump1.ogg', 'springy rising zip: jump, bounce pad'],
  land: ['impact-sounds', 'impactSoft_heavy_000.ogg', 'soft heavy thud: landing, something dropped'],
  hit: ['impact-sounds', 'impactPunch_medium_000.ogg', 'punch impact: hit, damage taken'],
  splat: ['sci-fi-sounds', 'slime_000.ogg', 'wet squelch: slime, goo, closest to a splash'],
  teleport: ['digital-audio', 'phaserUp1.ogg', 'rising phaser sweep: teleport, portal, respawn'],
  'door-open': ['rpg-audio', 'doorOpen_1.ogg', 'wooden door creaking open'],
  'door-close': ['rpg-audio', 'doorClose_1.ogg', 'wooden door shutting'],
  lever: ['rpg-audio', 'metalLatch.ogg', 'metal latch clack: lever, switch, lock'],
  explosion: ['sci-fi-sounds', 'lowFrequency_explosion_000.ogg', 'deep boom: explosion, cannon, big impact'],
  'fire-loop': ['sci-fi-sounds', 'thrusterFire_000.ogg', 'roaring flame: fire, lava, furnace, jet', true],
  'rumble-loop': ['sci-fi-sounds', 'spaceEngineLow_000.ogg', 'low engine rumble: machinery, cave, earthquake', true],
  'machine-loop': ['sci-fi-sounds', 'computerNoise_000.ogg', 'busy electronic chatter: computer room, lab, generator, machine', true]
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/sounds')
const MAX_ONE_SHOT_BYTES = 60 * 1024
const MAX_LOOP_BYTES = 300 * 1024
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024
// one-shots sit at a game-SFX level; loops play under them, so quieter
const TARGET_MEAN_DB = { oneShot: -18, loop: -24 }
const MAX_GAIN_DB = 12
const LOOP_CROSSFADE = 0.25

const ffmpeg = process.env.FFMPEG ?? ['/opt/homebrew/opt/ffmpeg@6/bin/ffmpeg'].find((p) => fs.existsSync(p)) ?? 'ffmpeg'
const ffprobe = ffmpeg === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(ffmpeg), 'ffprobe')
// ffmpeg reports on stderr, volumedetect included
function run(bin, args) {
  const r = spawnSync(bin, ['-hide_banner', '-v', 'info', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`)
  return `${r.stdout}${r.stderr}`
}
const seconds = (file) => Number(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim())
const meanDb = (file) => Number(run(ffmpeg, ['-i', file, '-af', 'volumedetect', '-f', 'null', '-']).match(/mean_volume: (-?[\d.]+) dB/)[1])

for (const entry of fs.readdirSync(out)) if (entry.endsWith('.mp3')) fs.rmSync(path.join(out, entry))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-'))

// Kenney's download links carry a content hash, so each is read from the pack's page
for (const pack of new Set(Object.values(PICKS).map(([p]) => p))) {
  const page = await (await fetch(`https://kenney.nl/assets/${pack}`)).text()
  const href = page.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"]+\.zip/)?.[0]
  if (href === undefined) throw new Error(`${pack}: no download link on its page`)
  const response = await fetch(href)
  if (!response.ok) throw new Error(`${pack}: ${response.status}`)
  const zip = path.join(work, `${pack}.zip`)
  fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()))
  execFileSync('unzip', ['-q', '-o', zip, '-d', path.join(work, pack)])
}

const properties = {}
let total = 0
for (const [name, [pack, file, description, loop = false]] of Object.entries(PICKS)) {
  const source = path.join(work, pack, 'Audio', file)
  const wav = path.join(work, `${name}.wav`)
  const mono = ['-ac', '1', '-ar', '44100']
  if (loop) {
    // the end fades into the start, so the wrap is the same sound continuing
    const length = seconds(source)
    const x = Math.min(LOOP_CROSSFADE, length / 4)
    // the source twice: one stream feeding acrossfade from a split stalls it
    run(ffmpeg, ['-y', '-i', source, '-i', source, '-filter_complex',
      `[1:a]atrim=0:${x},asetpts=PTS-STARTPTS[head];` +
      `[0:a][head]acrossfade=d=${x}:c1=qsin:c2=qsin,atrim=start=${x},asetpts=PTS-STARTPTS`, ...mono, wav])
  } else {
    const trim = 'silenceremove=start_periods=1:start_threshold=-50dB'
    run(ffmpeg, ['-y', '-i', source, '-af', `${trim},areverse,${trim},areverse`, ...mono, wav])
  }
  // gain toward the target level, a limiter keeping the peaks under -1 dB
  const gain = Math.min(MAX_GAIN_DB, (loop ? TARGET_MEAN_DB.loop : TARGET_MEAN_DB.oneShot) - meanDb(wav))
  const mp3 = path.join(out, `${name}.mp3`)
  const ending = loop ? '' : `,areverse,afade=t=in:d=0.01,areverse`
  run(ffmpeg, ['-y', '-i', wav, '-af', `volume=${gain.toFixed(1)}dB,alimiter=limit=0.89:attack=1:release=20:level=false${ending}`,
    '-c:a', 'libmp3lame', '-b:a', '96k', ...mono, '-map_metadata', '-1', '-id3v2_version', '0', mp3])
  const bytes = fs.statSync(mp3).size
  if (bytes > (loop ? MAX_LOOP_BYTES : MAX_ONE_SHOT_BYTES)) throw new Error(`${name}: ${bytes} bytes is over its cap`)
  total += bytes
  properties[name] = { description, durationSeconds: Math.round(seconds(mp3) * 100) / 100, loop }
  console.log(name.padEnd(16), pack.padEnd(18), `${(bytes / 1024).toFixed(1)} KB`.padStart(9), `${properties[name].durationSeconds}s`, `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`)
}
if (total > MAX_TOTAL_BYTES) throw new Error(`the library is ${total} bytes, over ${MAX_TOTAL_BYTES}`)
console.log('total', `${(total / 1024).toFixed(1)} KB`)
fs.writeFileSync(path.join(out, 'properties.json'), `${JSON.stringify(properties, null, 2)}\n`)
// the packs' folders unzip without write permission
execFileSync('chmod', ['-R', 'u+w', work])
fs.rmSync(work, { recursive: true, force: true })

const rows = Object.entries(PICKS).map(([name, [pack, file]]) => `| \`${name}\` | [${PACKS[pack]}](https://kenney.nl/assets/${pack}) | \`${file}\` |`)
fs.writeFileSync(path.join(out, 'CREDITS.md'), `# Sound credits

Every sound here comes from one of [Kenney](https://kenney.nl)'s audio packs, released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Each is a mono 96 kbps mp3, its silence
trimmed and its level brought to a common loudness under a -1 dB limiter; a \`-loop\` has its last quarter second
faded into its start. Lengths and descriptions are in \`properties.json\`.
The packs have no wind, crowd, water or music loop, so the library has none.
Regenerate with \`node packages/ui/scripts/pack-sounds.mjs\`.

| Sound | Kenney pack | File |
|---|---|---|
${rows.join('\n')}
`)
