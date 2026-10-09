export async function connectPreview(endpoint, framePath) {
  const version = await (await fetch(new URL('/json/version', endpoint), { signal: AbortSignal.timeout(10000) })).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    clearTimeout(call.timer)
    if (message.error) call.reject(new Error(message.error.message))
    else call.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 20000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetInfos } = await send('Target.getTargets')
  const target = targetInfos.find((item) => ['page', 'iframe'].includes(item.type) && item.url.includes(framePath))
  if (!target) { socket.close(); throw new Error('No matching preview frame. Open the project first or set --frame.') }
  const page = targetInfos.find((item) => item.type === 'page' && new URL(item.url).origin === new URL(target.url).origin)
  if (page) await send('Target.activateTarget', { targetId: page.targetId })
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  return {
    async evaluate(fn, arg) {
      const result = await send('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`, awaitPromise: true, returnByValue: true
      }, sessionId)
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text)
      return result.result.value
    },
    async key(key, down) { await this.keys([{ key, down }]) },
    async keys(changes) {
      const events = changes.map(({ key, down }) => ({
        key: key === 'Space' ? ' ' : key,
        code: key === 'Space' ? 'Space' : key === 'Shift' ? 'ShiftLeft' : `Key${key.toUpperCase()}`,
        keyCode: key === 'Space' ? 32 : key === 'Shift' ? 16 : key.toUpperCase().charCodeAt(0), down
      }))
      await this.evaluate((events) => {
        const canvas = document.querySelector('canvas')
        if (!canvas) throw new Error('Engine canvas unavailable.')
        canvas.focus()
        for (const { down, ...event } of events) canvas.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { ...event, bubbles: true }))
      }, events)
    },
    async click(x, y) {
      await this.evaluate(async ({ x, y }) => {
        const canvas = document.querySelector('canvas')
        if (!canvas) throw new Error('Engine canvas unavailable.')
        canvas.focus()
        const rect = canvas.getBoundingClientRect()
        const point = { clientX: rect.left + (x - rect.left) * canvas.width / rect.width, clientY: rect.top + (y - rect.top) * canvas.height / rect.height, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }
        canvas.dispatchEvent(new PointerEvent('pointermove', point))
        try {
          canvas.dispatchEvent(new PointerEvent('pointerdown', { ...point, button: 0, buttons: 1 }))
          await new Promise((resolve) => setTimeout(resolve, 100))
        } finally { canvas.dispatchEvent(new PointerEvent('pointerup', { ...point, button: 0, buttons: 0 })) }
      }, { x, y })
    },
    async screenshot() {
      const { sessionId: pageSession } = await send('Target.attachToTarget', { targetId: page?.targetId ?? target.targetId, flatten: true })
      const result = await send('Page.captureScreenshot', { format: 'png' }, pageSession)
      await send('Target.detachFromTarget', { sessionId: pageSession })
      return Buffer.from(result.data, 'base64')
    },
    close() { socket.close() }
  }
}
