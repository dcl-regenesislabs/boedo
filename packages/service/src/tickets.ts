// An upload ticket stands in for a presigned url: it lets its bearer PUT exactly one blob
// (this hash, this size) on behalf of one wallet, once, until it expires.

export interface Ticket {
  wallet: string
  size: number
  expires: number
}

export interface ReadTicket extends Ticket {
  /** The HMAC, hex: names this ticket when it is spent. */
  id: string
}

const encoder = new TextEncoder()

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

const message = (hash: string, ticket: Ticket) => encoder.encode(`${ticket.wallet}:${hash}:${ticket.size}:${ticket.expires}`)

export async function issueTicket(secret: string, hash: string, ticket: Ticket): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), message(hash, ticket)))
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${ticket.wallet}.${ticket.size}.${ticket.expires}.${hex}`
}

export async function readTicket(secret: string, hash: string, text: string, now: number): Promise<ReadTicket | null> {
  const match = /^(0x[0-9a-f]{40})\.(\d{1,15})\.(\d{1,15})\.([0-9a-f]{64})$/.exec(text)
  if (match == null) return null
  const ticket: Ticket = { wallet: match[1], size: Number(match[2]), expires: Number(match[3]) }
  const signature = Uint8Array.from(match[4].match(/../g) ?? [], (pair) => parseInt(pair, 16))
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, message(hash, ticket))
  return valid && ticket.expires > now ? { ...ticket, id: match[4] } : null
}
