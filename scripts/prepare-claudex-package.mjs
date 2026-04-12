#!/usr/bin/env node

import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const outDir = join(rootDir, '.build', 'claudex')
const distSourceDir = join(rootDir, 'dist')
const sanitizedBuildRootMarker = '<claudex-build-root>'

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const rootPackage = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const publishPackageName =
  process.env.CLAUDE_CODE_PACKAGE_NAME?.trim() || '@zju_han/claudex-cli'
const publishPackageVersion =
  process.env.CLAUDE_CODE_PACKAGE_VERSION?.trim() || rootPackage.version

const publishPackage = {
  name: publishPackageName,
  version: publishPackageVersion,
  description:
    'ClaudeX is a local coding agent CLI powered by OpenAI/Codex-compatible Responses models.',
  type: 'module',
  license: rootPackage.license,
  author: rootPackage.author,
  homepage: rootPackage.homepage,
  repository: rootPackage.repository,
  bugs: rootPackage.bugs,
  engines: rootPackage.engines,
  dependencies: {
    '@anthropic-ai/mcpb': rootPackage.dependencies['@anthropic-ai/mcpb'],
    '@anthropic-ai/sandbox-runtime':
      rootPackage.dependencies['@anthropic-ai/sandbox-runtime'],
  },
  optionalDependencies: {
    'modifiers-napi': '0.0.1',
  },
  bin: {
    claudex: 'cli.js',
  },
  files: ['cli.js', 'dist/**', 'README.md'],
  scripts: {
    prepublishOnly:
      "node -e \"const isAuthorized = process.env.AUTHORIZED === '1'; const isCi = process.env.CI === 'true'; const isGitHubActions = process.env.GITHUB_ACTIONS === 'true'; if (!isAuthorized || !isCi || !isGitHubActions) { console.error('ERROR: Direct publishing is not allowed.\\nPublish the generated package only from the authorized GitHub Actions release workflow.'); process.exit(1); }\"",
  },
}

writeFileSync(
  join(outDir, 'package.json'),
  `${JSON.stringify(publishPackage, null, 2)}\n`,
)

writeFileSync(
  join(outDir, 'cli.js'),
  "#!/usr/bin/env node\n\nimport './dist/cli.js'\n",
  { mode: 0o755 },
)

const readme = `# ClaudeX

ClaudeX is a local coding agent CLI built from the current ant variant in this repository.

## Install

\`\`\`bash
npm install -g ${publishPackageName}
claudex
\`\`\`

## Update

\`\`\`bash
npm update -g ${publishPackageName}
\`\`\`
`
writeFileSync(join(outDir, 'README.md'), readme)

cpSync(distSourceDir, join(outDir, 'dist'), { recursive: true })

const packagedCliPath = join(outDir, 'dist', 'cli.js')
const packagedCli = readFileSync(packagedCliPath, 'utf8')
const sanitizedCli = packagedCli.split(rootDir).join(sanitizedBuildRootMarker)
if (sanitizedCli !== packagedCli) {
  writeFileSync(packagedCliPath, sanitizedCli)
}

try {
  unlinkSync(join(outDir, 'dist', 'cli.js.map'))
} catch {
  // source map is optional in publish output
}
