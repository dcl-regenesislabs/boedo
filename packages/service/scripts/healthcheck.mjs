const port = process.env.HTTP_SERVER_PORT ?? '8787'
try {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(4000) })
  process.exitCode = response.ok ? 0 : 1
} catch {
  process.exitCode = 1
}
