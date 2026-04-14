import type { Command } from '../../types/command.js'

const command = {
  type: 'local',
  name: 'opus',
  description: 'Toggle opus prompt mode (enabled by default; deeper analysis, stronger structure, higher proactivity)',
  isHidden: false,
  supportsNonInteractive: false,
  load: () => import('./opus-mode.js'),
} satisfies Command

export default command
