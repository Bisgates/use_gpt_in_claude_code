import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadFileSync = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockMkdirSync = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockCopyFile = vi.hoisted(() => vi.fn())
const mockLogError = vi.hoisted(() => vi.fn())
const mockGetInitialSettings = vi.hoisted(() => vi.fn())
const mockGetEnvironmentKind = vi.hoisted(() => vi.fn(() => null))
const mockGetOriginalCwd = vi.hoisted(() => vi.fn(() => '/repo/project'))
const mockGetSessionId = vi.hoisted(() => vi.fn(() => 'session-123'))
const planSlugCache = vi.hoisted(() => new Map<string, string>())

vi.mock('fs/promises', () => ({
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}))

vi.mock('../../../src/bootstrap/state.js', () => ({
  getPlanSlugCache: () => planSlugCache,
  getSessionId: () => mockGetSessionId(),
  getOriginalCwd: () => mockGetOriginalCwd(),
}))

vi.mock('../../../src/utils/debug.js', () => ({
  logForDebugging: vi.fn(),
}))

vi.mock('../../../src/utils/envUtils.js', () => ({
  getClaudeConfigHomeDir: () => '/mock-home/.claude',
}))

vi.mock('../../../src/utils/filePersistence/outputsScanner.js', () => ({
  getEnvironmentKind: () => mockGetEnvironmentKind(),
}))

vi.mock('../../../src/utils/fsOperations.js', () => ({
  getFsImplementation: () => ({
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  }),
}))

vi.mock('../../../src/utils/log.js', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}))

vi.mock('../../../src/utils/settings/settings.js', () => ({
  getInitialSettings: () => mockGetInitialSettings(),
}))

vi.mock('../../../src/utils/words.js', () => ({
  generateWordSlug: () => 'fresh-plan',
}))

async function loadPlansModule() {
  vi.resetModules()
  return import('../../../src/utils/plans.ts')
}

describe('plans directory defaults', () => {
  beforeEach(() => {
    planSlugCache.clear()
    mockReadFileSync.mockReset()
    mockExistsSync.mockReset()
    mockMkdirSync.mockReset()
    mockReadFile.mockReset()
    mockWriteFile.mockReset()
    mockCopyFile.mockReset()
    mockLogError.mockReset()
    mockGetInitialSettings.mockReset()
    mockGetEnvironmentKind.mockReset()
    mockGetEnvironmentKind.mockReturnValue(null)
    mockGetOriginalCwd.mockReset()
    mockGetOriginalCwd.mockReturnValue('/repo/project')
    mockGetSessionId.mockReset()
    mockGetSessionId.mockReturnValue('session-123')
    mockExistsSync.mockReturnValue(false)
    mockGetInitialSettings.mockReturnValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('[P0:tool] defaults plan storage to the project-local .claude/plans directory rooted at originalCwd', async () => {
    const plans = await loadPlansModule()

    expect(plans.getPlansDirectory()).toBe('/repo/project/.claude/plans')
    expect(mockMkdirSync).toHaveBeenCalledWith('/repo/project/.claude/plans')
  })

  it('[P0:tool] resolves explicit plansDirectory relative to originalCwd instead of transient cwd', async () => {
    mockGetInitialSettings.mockReturnValue({ plansDirectory: '.tmp/plans' })
    const plans = await loadPlansModule()

    expect(plans.getPlansDirectory()).toBe('/repo/project/.tmp/plans')
    expect(mockMkdirSync).toHaveBeenCalledWith('/repo/project/.tmp/plans')
  })

  it('[P0:tool] falls back to the legacy global plan location for reads when the new default path is empty and no override is configured', async () => {
    const plans = await loadPlansModule()
    planSlugCache.set('session-123', 'legacy-slug')

    mockReadFileSync.mockImplementation((path: string) => {
      if (path === '/repo/project/.claude/plans/legacy-slug.md') {
        const error = new Error('ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      if (path === '/mock-home/.claude/plans/legacy-slug.md') {
        return 'legacy plan content'
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    expect(plans.getPlan()).toBe('legacy plan content')
    expect(mockReadFileSync).toHaveBeenNthCalledWith(
      1,
      '/repo/project/.claude/plans/legacy-slug.md',
      { encoding: 'utf-8' },
    )
    expect(mockReadFileSync).toHaveBeenNthCalledWith(
      2,
      '/mock-home/.claude/plans/legacy-slug.md',
      { encoding: 'utf-8' },
    )
  })

  it('[P0:tool] prefers the configured plansDirectory and skips legacy fallback when an override is set', async () => {
    mockGetInitialSettings.mockReturnValue({ plansDirectory: '.tmp/plans' })
    const plans = await loadPlansModule()
    planSlugCache.set('session-123', 'configured-slug')

    mockReadFileSync.mockImplementation((path: string) => {
      const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })

    expect(plans.getPlan()).toBeNull()
    expect(mockReadFileSync).toHaveBeenCalledTimes(1)
    expect(mockReadFileSync).toHaveBeenCalledWith(
      '/repo/project/.tmp/plans/configured-slug.md',
      { encoding: 'utf-8' },
    )
  })
})
