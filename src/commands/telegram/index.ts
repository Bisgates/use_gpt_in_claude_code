import type { Command } from '../../commands.js'

const telegram = {
  type: 'local',
  name: 'telegram',
  description: 'Configure Telegram notifications (setup/show/clear/test)',
  supportsNonInteractive: false,
  load: () => import('./telegram.js'),
} satisfies Command

export default telegram
