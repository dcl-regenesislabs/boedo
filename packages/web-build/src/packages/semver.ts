// The part of node-semver that package manifests use: versions, and ranges made of
// ^ ~ comparators, x-ranges, hyphen ranges and ||. No loose parsing, no build-metadata ordering.

export interface Version {
  major: number
  minor: number
  patch: number
  prerelease: (string | number)[]
}

interface Comparator {
  op: '<' | '<=' | '>' | '>=' | '='
  version: Version
}

const NUMBER = '0|[1-9]\\d*'
const PRERELEASE = '(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z.-]+)?'
const VERSION = new RegExp(`^[v=\\s]*(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})${PRERELEASE}$`)
const X = `${NUMBER}|[xX*]`
const PARTIAL = new RegExp(`^[v=\\s]*(${X})(?:\\.(${X})(?:\\.(${X})${PRERELEASE})?)?$`)
const PRIMITIVE = /^(<=|>=|<|>|=|\^|~>|~)?\s*(.*)$/
const MAX_LENGTH = 256

export function parseVersion(text: string): Version | undefined {
  if (text.length > MAX_LENGTH) return undefined
  const match = VERSION.exec(text.trim())
  if (match === null) return undefined
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined
  return { major, minor, patch, prerelease: prereleaseOf(match[4]) }
}

const prereleaseOf = (text: string | undefined): (string | number)[] =>
  text === undefined ? [] : text.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))

export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (core !== 0) return Math.sign(core)
  // a release sorts after its own prereleases
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length)
  for (let i = 0; ; i++) {
    const [x, y] = [a.prerelease[i], b.prerelease[i]]
    if (x === undefined && y === undefined) return 0
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1
    return x < y ? -1 : 1
  }
}

const at = (major: number, minor = 0, patch = 0, prerelease: (string | number)[] = []): Version => ({ major, minor, patch, prerelease })
const isX = (part: string | undefined): boolean => part === undefined || /^[xX*]$/.test(part)

// One primitive ("^1.2", ">=1.0.0", "1.x") as the comparators it stands for; null when it cannot match anything.
function expand(primitive: string, includePrerelease: boolean): Comparator[] | null | undefined {
  const [, op = '', rest = ''] = PRIMITIVE.exec(primitive) ?? []
  const match = PARTIAL.exec(rest)
  if (match === null) return undefined
  const [xMajor, xMinor, xPatch] = [isX(match[1]), isX(match[2]), isX(match[3])]
  const major = xMajor ? 0 : Number(match[1])
  const minor = xMajor || xMinor ? 0 : Number(match[2])
  const patch = xMajor || xMinor || xPatch ? 0 : Number(match[3])
  const full = !xMajor && !xMinor && !xPatch
  // with prereleases included, a partial version starts at its first prerelease
  const floor = includePrerelease ? [0] : []
  const from = at(major, minor, patch, full ? prereleaseOf(match[4]) : floor)
  const below = (version: Version): Comparator => ({ op: '<', version: { ...version, prerelease: [0] } })
  const nextMajor = at(major + 1)
  const nextMinor = at(major, minor + 1)

  if (op === '^') {
    if (xMajor) return []
    let upper = at(major, minor, patch + 1)
    if (major > 0 || xMinor) upper = nextMajor
    else if (minor > 0 || xPatch) upper = nextMinor
    return [{ op: '>=', version: from }, below(upper)]
  }
  if (op === '~' || op === '~>') {
    if (xMajor) return []
    return [{ op: '>=', version: from }, below(xMinor ? nextMajor : nextMinor)]
  }
  if (full) return [{ op: op === '' ? '=' : (op as Comparator['op']), version: from }]
  if (op === '' || op === '=') {
    if (xMajor) return []
    return [{ op: '>=', version: from }, below(xMinor ? nextMajor : nextMinor)]
  }
  if (xMajor) return op === '<' || op === '>' ? null : []
  const next = xMinor ? nextMajor : nextMinor
  if (op === '>') return [{ op: '>=', version: { ...next, prerelease: floor } }]
  if (op === '<=') return [below(next)]
  if (op === '<') return [below(from)]
  return [{ op: '>=', version: from }]
}

function hyphen(low: string, high: string, includePrerelease: boolean): Comparator[] | undefined {
  const lower = expand('>=' + low, includePrerelease)
  const upper = expand('<=' + high, includePrerelease)
  if (lower === undefined || upper === undefined || lower === null || upper === null) return undefined
  const [start] = lower
  if (includePrerelease && start !== undefined && start.version.prerelease.length === 0) start.version.prerelease = [0]
  return [...lower, ...upper]
}

// The "||" alternatives of a range; undefined when the text is not a range.
function parseRange(range: string, includePrerelease = false): Comparator[][] | undefined {
  if (range.length > MAX_LENGTH) return undefined
  const sets: Comparator[][] = []
  for (const alternative of range.split('||')) {
    const text = alternative.trim()
    const span = /^(\S+)\s+-\s+(\S+)$/.exec(text)
    if (span !== null) {
      const set = hyphen(span[1], span[2], includePrerelease)
      if (set === undefined) return undefined
      sets.push(set)
      continue
    }
    const set: Comparator[] = []
    let impossible = false
    // an operator may be written apart from its version: ">= 1.2.3"
    for (const primitive of text.replace(/(<=|>=|<|>|=|\^|~>|~)\s+/g, '$1').split(/\s+/)) {
      if (primitive === '') continue
      const comparators = expand(primitive, includePrerelease)
      if (comparators === undefined) return undefined
      if (comparators === null) impossible = true
      else set.push(...comparators)
    }
    if (!impossible) sets.push(set)
  }
  return sets
}

export const validRange = (range: string): boolean => parseRange(range) !== undefined

function holds(version: Version, { op, version: bound }: Comparator): boolean {
  const order = compareVersions(version, bound)
  switch (op) {
    case '=':
      return order === 0
    case '<':
      return order < 0
    case '<=':
      return order <= 0
    case '>':
      return order > 0
    case '>=':
      return order >= 0
  }
}

export function satisfies(version: string | Version, range: string, options: { includePrerelease?: boolean } = {}): boolean {
  const parsed = typeof version === 'string' ? parseVersion(version) : version
  const sets = parseRange(range, options.includePrerelease === true)
  if (parsed === undefined || sets === undefined) return false
  return sets.some((set) => {
    if (!set.every((comparator) => holds(parsed, comparator))) return false
    if (parsed.prerelease.length === 0 || options.includePrerelease === true) return true
    // a prerelease only matches a range that names a prerelease of the same release
    return set.some(
      ({ version: bound }) =>
        bound.prerelease.length > 0 && bound.major === parsed.major && bound.minor === parsed.minor && bound.patch === parsed.patch
    )
  })
}

export function maxSatisfying(versions: Iterable<string>, range: string): string | undefined {
  let best: { text: string; version: Version } | undefined
  for (const text of versions) {
    const version = parseVersion(text)
    if (version === undefined || !satisfies(version, range)) continue
    if (best === undefined || compareVersions(version, best.version) > 0) best = { text, version }
  }
  return best?.text
}
