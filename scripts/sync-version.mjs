import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rootPkgPath = resolve('package.json')
const litePkgPath = resolve('packages/lite/package.json')

const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
const litePkg = JSON.parse(readFileSync(litePkgPath, 'utf8'))

if (litePkg.version !== rootPkg.version) {
  litePkg.version = rootPkg.version
  writeFileSync(litePkgPath, JSON.stringify(litePkg, null, 2) + '\n')
  console.log(`✓ Synced dsh-balance-lite version to ${rootPkg.version}`)
} else {
  console.log(`✓ Versions are already in sync (${rootPkg.version})`)
}
