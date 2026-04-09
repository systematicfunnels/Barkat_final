const { spawn } = require('child_process')

const [, , runtime, scriptName] = process.argv

if (!runtime || !scriptName) {
  console.error('Usage: node scripts/run-runtime-task.cjs <node|electron> <script-name>')
  process.exit(1)
}

const runScript = (name) =>
  new Promise((resolve, reject) => {
    const child = spawn(`npm run ${name}`, {
      stdio: 'inherit',
      env: process.env,
      shell: true
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      resolve(typeof code === 'number' ? code : 1)
    })
  })

async function main() {
  if (runtime === 'node') {
    const rebuildNodeCode = await runScript('native:rebuild:node')
    if (rebuildNodeCode !== 0) {
      process.exit(rebuildNodeCode)
    }

    let commandCode = 0
    try {
      commandCode = await runScript(scriptName)
    } finally {
      const restoreElectronCode = await runScript('native:rebuild:electron')
      if (commandCode === 0 && restoreElectronCode !== 0) {
        commandCode = restoreElectronCode
      }
    }

    process.exit(commandCode)
  }

  if (runtime === 'electron') {
    const buildCode = await runScript('build')
    if (buildCode !== 0) {
      process.exit(buildCode)
    }

    const commandCode = await runScript(scriptName)
    process.exit(commandCode)
  }

  console.error(`Unsupported runtime: ${runtime}`)
  process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
