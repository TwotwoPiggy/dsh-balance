import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const liteDir = resolve('packages/lite')
const extraArgs = process.argv.slice(2).join(' ')
const cmd = `npm publish --access public ${extraArgs}`.trim()

console.log(`Publishing dsh-balance-lite from ${liteDir}...`)
execSync(cmd, { cwd: liteDir, stdio: 'inherit' })
