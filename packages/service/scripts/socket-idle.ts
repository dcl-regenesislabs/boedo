// Holds one assistant socket idle and reports how it ends: whether the service's keepalive pings
// arrive, and whether a proxy in front closes it. A signed-in test wallet asks for the ticket.
//   BASE=https://… ORIGIN=https://decentraland.zone IDLE_SECONDS=130 node packages/service/scripts/socket-idle.ts
import { WebSocket } from 'ws'
import { ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX } from '../../contract/src/assistant.ts'
import { createTestWallet } from '../src/testing/wallet.ts'

const base = process.env.BASE ?? 'http://localhost:8787'
const origin = process.env.ORIGIN ?? 'http://localhost:5173'
const seconds = Number(process.env.IDLE_SECONDS ?? 130)

const wallet = await createTestWallet({ origin })
const connect = await wallet.signedFetch(`${base}/assistant/connect`, { method: 'POST' })
if (!connect.ok) throw new Error(`/assistant/connect answered ${connect.status}: ${await connect.text()}`)
const { token } = (await connect.json()) as { token: string }

const started = Date.now()
const at = (): string => `${Math.round((Date.now() - started) / 1000)}s`
const socket = new WebSocket(base.replace(/^http/, 'ws') + '/assistant/socket', [ASSISTANT_PROTOCOL, ASSISTANT_TICKET_PREFIX + token], { origin })
let pings = 0
socket.on('open', () => console.log(`${at()} open`))
socket.on('ping', () => { pings++; console.log(`${at()} ping ${pings}`) })
socket.on('close', (code, reason) => {
  console.log(`${at()} closed ${code} ${reason.toString()}`)
  process.exit(0)
})
setTimeout(() => {
  console.log(`${at()} still open after ${seconds}s, ${pings} pings`)
  socket.close()
}, seconds * 1000)
