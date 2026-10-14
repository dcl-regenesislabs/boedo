// Modules that only exist in Node: a scene runs in a sandbox with none of them.
const NODE_BUILTINS = new Set(
  (
    'assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs ' +
    'http http2 https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder ' +
    'sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib'
  ).split(' ')
)

export const isNodeBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/', 1)[0])
