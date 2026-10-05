// A fetch held to a subresource-integrity hash. The browser refuses a mismatch
// with the same error as a network failure, so a refusal is fetched once more
// without the hash only to say which of the two it was.
export async function fetchVerified(url: string, integrity: string | undefined, name: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, integrity === undefined ? {} : { integrity, mode: 'cors' })
  } catch (error) {
    if (integrity === undefined) throw error
    const reachable = await fetch(url).then(
      (plain) => plain.ok,
      () => false
    )
    throw new Error(
      reachable
        ? `${name} does not match the hash this editor was published with. The editor will not run it: reload the page, and if this persists the files you were served were altered.`
        : `${name} could not be loaded (${url}). Check the connection and reload the page.`
    )
  }
  if (!response.ok) throw new Error(`${name} could not be loaded: ${response.status} ${url}`)
  return response
}
