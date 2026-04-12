#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const packageDir = join(rootDir, '.build', 'claudex')
const packageJsonPath = join(packageDir, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const tarballName = `${packageJson.name.replace(/^@/, '').replace('/', '-')}-${packageJson.version}.tgz`
const tarballPath = join(packageDir, tarballName)
const tmpExtractDir = mkdtempSync(join(tmpdir(), 'claudex-pack-verify-'))

const forbiddenEntryPatterns = [
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.codex(\/|$)/,
  /(^|\/)plans(\/|$)/,
  /(^|\/)worktrees(\/|$)/,
  /(^|\/)history\.jsonl$/,
  /(^|\/)MEMORY\.md$/,
  /(^|\/)settings\.local\.json$/,
  /(^|\/)package\/dist\/.*\.jsonl$/,
  /(^|\/)package\/dist\/.*\.log$/,
  /(^|\/)package\/dist\/.*\.cast$/,
  /(^|\/)package\/dist\/.*\.map$/,
]

function sanitizePath(value) {
  return value.replace(/[^a-zA-Z0-9]/g, '-')
}

const forbiddenContentPatterns = [sanitizePath(rootDir)]

function run(command, args, cwd = packageDir) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
  })
}

function fail(message) {
  throw new Error(`claudex package verification failed: ${message}`)
}

try {
  run('npm', ['pack'], packageDir)

  const fileListOutput = run('tar', ['-tf', tarballPath], packageDir)
  const entries = fileListOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  for (const entry of entries) {
    for (const pattern of forbiddenEntryPatterns) {
      if (pattern.test(entry)) {
        fail(`forbidden packaged entry detected: ${entry}`)
      }
    }
  }

  run('tar', ['-xzf', tarballPath, '-C', tmpExtractDir], packageDir)

  const textLikeEntries = entries.filter(entry => {
    const lower = entry.toLowerCase()
    return (
      lower.endsWith('.js') ||
      lower.endsWith('.json') ||
      lower.endsWith('.md') ||
      lower.endsWith('.txt')
    )
  })

  for (const entry of textLikeEntries) {
    const filePath = join(tmpExtractDir, entry)
    const contents = readFileSync(filePath, 'utf8')
    for (const marker of forbiddenContentPatterns) {
      if (marker && contents.includes(marker)) {
        fail(`forbidden content marker "${marker}" detected in ${entry}`)
      }
    }
  }

  process.stdout.write(`Verified clean package: ${tarballPath}\n`)
} finally {
  rmSync(tmpExtractDir, { recursive: true, force: true })
}
