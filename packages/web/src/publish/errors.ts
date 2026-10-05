// Why a publish stopped, in words a creator can act on. The Worlds content
// server has no error codes: a refusal is a 400 whose message carries one of
// the sentences its validations write, so those sentences are matched here.

export type PublishFailure =
  | 'cancelled'
  | 'not-signed-in'
  | 'build'
  | 'invalid-scene'
  | 'permission'
  | 'too-large'
  | 'expired'
  | 'changed'
  | 'refused'
  | 'busy'
  | 'network'

export class PublishError extends Error {
  constructor(
    readonly reason: PublishFailure,
    message: string,
    // publishing the same scene again could work
    readonly retryable = false,
    // what the server said, for the log
    readonly detail?: string
  ) {
    super(message)
    this.name = 'PublishError'
  }
}

const mb = (bytes: number): string => {
  const value = bytes / (1024 * 1024)
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`
}

export const UNREACHABLE = "Could not reach Decentraland's world server. Check your connection and try again."

function serverMessage(body: string): string {
  try {
    const json: unknown = JSON.parse(body)
    if (typeof json === 'object' && json !== null) {
      const { message, error } = json as { message?: unknown; error?: unknown }
      if (typeof message === 'string' && message !== '') return message
      if (typeof error === 'string') return error
    }
  } catch {
    /* not JSON: the body is the message */
  }
  return body.trim().slice(0, 500)
}

// What `POST /entities` answered when it was not a 200.
export function refusal(status: number, body: string, world: string): PublishError {
  const said = serverMessage(body).replace(/^(Deployment failed: )+/, '')
  const error = (reason: PublishFailure, message: string, retryable = false): PublishError =>
    new PublishError(reason, message, retryable, `${status} ${said}`)

  if (status === 409) {
    return error('changed', `${world} changed while this scene was being published. Nothing was replaced. Publish again.`, true)
  }
  if (status === 413 || /multipart request is too large/i.test(said)) {
    return error('too-large', 'This scene is too large to upload: a publish takes 350 MB at most. Remove or shrink its largest files.')
  }
  if (status === 408) return error('busy', 'The upload took too long and was stopped. Try again on a faster connection.', true)
  if (status === 429 || status === 503) return error('busy', "Decentraland's world server is busy. Try again in a minute.", true)
  if (status >= 500) return error('busy', `Decentraland's world server had a problem (${status}). Try again in a minute.`, true)

  if (/no permission to publish|does not have permission to deploy/i.test(said)) {
    return error(
      'permission',
      `This wallet can't publish to ${world}. Publish to a NAME you own, or ask the owner of ${world} to add your wallet to its deployment list.`
    )
  }
  if (/name deny list/i.test(said)) {
    return error('permission', `${world} can't be published to: the name is on Decentraland's deny list.`)
  }
  const size = /maximum total size allowed is (\d+) bytes.*tried to upload (\d+)/i.exec(said)
  if (size !== null) {
    return error(
      'too-large',
      `This scene is ${mb(Number(size[2]))} and ${world} has room for ${mb(Number(size[1]))}. Remove or shrink files (models, textures, sounds), or free space in your other worlds.`
    )
  }
  const count = /maximum allowed is (\d+) but the deployment has (\d+)/i.exec(said)
  if (count !== null) return error('too-large', `This scene has ${count[2]} files and a world takes ${count[1]} at most.`)
  const parcels = /Max allowed scene dimensions is (\d+) parcels/i.exec(said)
  if (parcels !== null) {
    return error('too-large', `This scene covers more parcels than ${world} allows (${parcels[1]}). Use fewer parcels in Scene settings.`)
  }
  if (/secs ago/i.test(said)) {
    return error('expired', 'The confirmation took more than five minutes, so the signature expired. Publish again.', true)
  }
  if (/in the future/i.test(said)) {
    return error('expired', "This device's clock is ahead of the server's. Check the date and time, then publish again.")
  }
  if (/Invalid entity hash|doesn't match the provided content|Extra file detected|neither present in the storage|Only CIDv1/i.test(said)) {
    return error('refused', 'The upload did not arrive intact. Publish again.', true)
  }
  if (/ephemeral|signature|auth ?chain|signer/i.test(said)) {
    return error('not-signed-in', 'Decentraland could not verify your signature. Sign in again, then publish again.')
  }
  if (/thumbnail/i.test(said)) {
    return error('invalid-scene', 'The scene thumbnail is not one of the published files. Choose it again in Scene settings.')
  }
  if (/worldConfiguration|scene\.json|pointers|parcel|must have required property|must be|is not present in the entity/i.test(said)) {
    return error('invalid-scene', `Decentraland did not accept this scene's settings: ${said}`)
  }
  return error('refused', `Decentraland refused this scene: ${said === '' ? `status ${status}` : said}`)
}
