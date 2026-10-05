// The in-tab server copy prints into the engine, not a process the shell can read, so its console is polled as a tail.
const TAIL = 200
const POLL_MS = 2000
const NOT_A_LINE = /^\((?:no logs|\+\d+ older entries not retained)\)$/

// the longest end of `previous` that `tail` starts with was already relayed
function unseenLines(previous: readonly string[], tail: readonly string[]): string[] {
  for (let k = Math.min(previous.length, tail.length); k > 0; k--) {
    const start = previous.length - k
    if (tail.slice(0, k).every((line, i) => line === previous[start + i])) return tail.slice(k)
  }
  return [...tail]
}

export function relayServerLogs(engineConsole: (line: string) => Promise<string>, emit: (line: string) => void): () => void {
  let previous: string[] = []
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = async (): Promise<void> => {
    try {
      const reply = await engineConsole(`scene_logs ${TAIL} --server`)
      if (stopped) return
      const tail = reply.split('\n').filter((line) => line.trim() !== '' && !NOT_A_LINE.test(line.trim()))
      for (const line of unseenLines(previous, tail)) emit(line)
      previous = tail
    } catch {
      /* no server copy to read */
    }
    if (!stopped) timer = setTimeout(() => void read(), POLL_MS)
  }
  void read()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
