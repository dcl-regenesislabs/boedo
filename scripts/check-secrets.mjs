import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const forbidden = /(?:^|\/)(?:\.env[^/]*|\.auth\.json[^/]*)$/
const binary = /\.(?:png|jpe?g|gif|webp|glb|wasm|ico|woff2?|ttf|mp[34]|zip|gz)$/i
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['anthropic-token', /sk-ant-(?:api03|oat01)-[a-zA-Z0-9_-]{30,}/],
  ['github-token', /(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,})/],
  ['aws-access-key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['slack-token', /xox[baprs]-[a-zA-Z0-9-]{24,}/],
  ['oauth-token', /["'](?:refresh_token|access_token)["']\s*:\s*["'][a-zA-Z0-9_.-]{30,}["']/]
]

export function secretFindings(name, source = '') {
  if (forbidden.test(name)) return [{ path: name, rule: 'credential-file' }]
  const findings = []
  for (const [rule, pattern] of patterns) {
    const match = pattern.exec(source)
    if (match !== null) findings.push({ path: name, rule, line: source.slice(0, match.index).split('\n').length })
  }
  return findings
}

function check(history) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 })
  const findings = []
  let scanned = 0
  const names = new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').toString().split('\0').filter(Boolean))
  for (const name of names) {
    if (forbidden.test(name)) { findings.push(...secretFindings(name)); continue }
    if (binary.test(name)) continue
    const file = path.join(root, name)
    const info = lstatSync(file, { throwIfNoEntry: false })
    if (!info?.isFile()) continue
    findings.push(...secretFindings(name, readFileSync(file, 'utf8')))
    scanned++
  }
  if (history) {
    const objects = git('rev-list', '--objects', 'HEAD').toString().split('\n')
    for (const line of objects) {
      const match = /^([a-f0-9]{40,64}) (.+)$/.exec(line)
      if (match === null) continue
      const [, id, name] = match
      if (forbidden.test(name)) { findings.push({ ...secretFindings(name)[0], object: id }); continue }
      if (binary.test(name) || git('cat-file', '-t', id).toString().trim() !== 'blob') continue
      findings.push(...secretFindings(name, git('cat-file', 'blob', id).toString()).map((finding) => ({ ...finding, object: id })))
      scanned++
    }
  }
  console.log(JSON.stringify({ scanned, findings }, null, 2))
  process.exitCode = findings.length === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) check(process.argv.includes('--history'))
