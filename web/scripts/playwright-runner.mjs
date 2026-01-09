import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const DEFAULT_PORT = 4173
const rawPort = process.env.PLAYWRIGHT_PORT
const preferredPort = rawPort ? Number(rawPort) : DEFAULT_PORT

if (!Number.isFinite(preferredPort) || preferredPort <= 0) {
  throw new Error('PLAYWRIGHT_PORT must be a valid port number.')
}

async function isPortAvailable(port) {
  return await new Promise((resolve) => {
    const socket = new net.Socket()
    const finalize = (available) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(available)
    }

    socket.setTimeout(500)
    socket.once('timeout', () => finalize(true))
    socket.once('error', (err) => {
      if (err?.code === 'ECONNREFUSED') {
        finalize(true)
      } else {
        finalize(false)
      }
    })
    socket.connect(port, '127.0.0.1', () => finalize(false))
  })
}

async function getEphemeralPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', (err) => reject(err))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an ephemeral port.')))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

async function resolvePort() {
  if (rawPort) return preferredPort
  const preferredAvailable = await isPortAvailable(preferredPort)
  if (preferredAvailable) return preferredPort
  return await getEphemeralPort()
}

const port = await resolvePort()
process.env.PLAYWRIGHT_PORT = String(port)

const cliPath = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url))
const args = ['test', ...process.argv.slice(2)]
const child = spawn(process.execPath, [cliPath, ...args], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
