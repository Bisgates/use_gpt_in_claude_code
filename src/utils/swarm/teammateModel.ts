import { CLAUDE_OPUS_4_6_CONFIG } from '../model/configs.js'
import { getAPIProvider } from '../model/providers.js'
import {
  isOpenAIResponsesBackendEnabled,
  resolveOpenAIModel,
} from '../../services/modelBackend/openaiCodexConfig.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// When the user has never set teammateDefaultModel in /config, new teammates
// inherit the leader's model by default. If no leader model is known yet,
// fall back to a provider-aware default.
export function getHardcodedTeammateModelFallback(): string {
  if (isOpenAIResponsesBackendEnabled()) {
    return resolveOpenAIModel('opus')
  }
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}
