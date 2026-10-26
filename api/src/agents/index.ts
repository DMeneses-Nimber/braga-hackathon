import { createXai } from '@ai-sdk/xai'
import { wrapLanguageModel } from 'ai'

import type { AgentConfig } from '../config.js'
import type { AgentsStatus } from '../schemas/index.js'
import { AgentCache } from './cache.js'
import { createBrowseAgent } from './browse/agent.js'
import { createCompareAgent } from './compare/agent.js'
import { loadSkill, loadSources, readSkillFile } from './skills.js'
import { SourceCatalog } from './sources.js'
import { createSourceTools } from './browse/tools/index.js'
import type { Agents } from './types.js'

/** Builds the two agents from the skills, or says why they are off. */
export async function createAgents(config: AgentConfig): Promise<{ agents?: Agents; status: AgentsStatus }> {
  const status: AgentsStatus = {
    enabled: false,
    reason: null,
    models: config.models,
    tools: {
      googleMaps: config.googleMapsApiKey !== undefined,
      webSearch: config.tavilyApiKey !== undefined,
    },
    offline: config.offline,
  }
  if (!config.grokApiKey && !config.offline) {
    return {
      status: {
        ...status,
        reason: 'Falta a chave do Grok: defina XAI_API_KEY em api/.env e reinicie a API.',
      },
    }
  }

  const [browseSkill, compareSkill, sources] = await Promise.all([
    loadSkill(config.skillsDir, 'browse-data'),
    loadSkill(config.skillsDir, 'compare-data'),
    loadSources(config.skillsDir),
  ])
  const rules = await readSkillFile(compareSkill, 'references/regras.md')
  const catalog = new SourceCatalog(sources)
  const cache = new AgentCache(config.cacheDir, config.offline)
  // In offline mode the key isn't used, because every answer comes from the cache.
  const provider = createXai({ apiKey: config.grokApiKey ?? 'modo-offline' })
  const browseModel = wrapLanguageModel({
    model: provider(config.models.browse),
    middleware: cache.middleware(),
  })
  const compareModel = wrapLanguageModel({
    model: provider(config.models.compare),
    middleware: cache.middleware(),
  })
  const tools = createSourceTools({
    cache,
    googleMapsApiKey: config.googleMapsApiKey,
    tavilyApiKey: config.tavilyApiKey,
  })
  return {
    agents: {
      browse: createBrowseAgent({
        model: browseModel,
        // With high demand on its own model, a company's collection runs on the comparison model instead.
        fallbackModel: config.models.browse === config.models.compare ? undefined : compareModel,
        instructions: `${browseSkill.instructions}\n\n## Fontes por campo\n\n${catalog.describe()}`,
        sources: catalog,
        tools,
        maxSteps: config.maxSteps,
      }),
      compare: createCompareAgent({
        model: compareModel,
        instructions: `${compareSkill.instructions}\n\n${rules}`,
        sources: catalog,
      }),
    },
    status: {
      ...status,
      enabled: true,
      reason: config.offline ? 'Modo offline: as verificações só usam respostas guardadas.' : null,
    },
  }
}
