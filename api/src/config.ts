import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { prettifyError, z } from 'zod'

// Relative paths in .env don't depend on where the command runs.
/** The api/ folder, one level up from this file. */
export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The model used when an agent has none configured. */
export const DEFAULT_MODEL = 'grok-4.7'

// An empty value counts as unset.
function blankToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const optionalText = z.preprocess(blankToUndefined, z.string().optional())

function integerOption(minimum: number, maximum: number, fallback: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return fallback
    if (typeof value === 'string' && value.trim() === '') return fallback
    return typeof value === 'string' ? value.trim() : value
  }, z.coerce.number().int().min(minimum).max(maximum))
}

const EnvSchema = z.object({
  PORT: integerOption(1, 65535, 3000),
  DATA_DIR: z.preprocess(blankToUndefined, z.string().min(1).default('../data')),
  XAI_API_KEY: optionalText,
  GROK_MODEL_RECOLHA: optionalText,
  GROK_MODEL_COMPARACAO: optionalText,
  GOOGLE_MAPS_API_KEY: optionalText,
  TAVILY_API_KEY: optionalText,
  MODO_OFFLINE: optionalText,
  AGENT_MAX_STEPS: integerOption(4, 40, 16),
  CACHE_DIR: z.preprocess(blankToUndefined, z.string().min(1).default('../data/cache')),
  SKILLS_DIR: z.preprocess(blankToUndefined, z.string().min(1).default('../.agents/skills')),
})

/** What the agents need from the environment. Answer only from the cache, for the demo without internet. */
export interface AgentConfig {
  grokApiKey: string | undefined
  models: { browse: string; compare: string }
  googleMapsApiKey: string | undefined
  tavilyApiKey: string | undefined
  offline: boolean
  maxSteps: number
  cacheDir: string
  skillsDir: string
}

/** The port, the data folder and the agent configuration. */
export interface Config {
  port: number
  dataDir: string
  agents: AgentConfig
}

/** Loads api/.env when it exists, then reads the environment. */
export function loadConfig(): Config {
  const envFile = path.join(API_ROOT, '.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(`Configuração inválida:\n${prettifyError(parsed.error)}`)
  }
  const env = parsed.data
  const offline = ['1', 'true', 'sim'].includes((env.MODO_OFFLINE ?? '').toLowerCase())
  return {
    port: env.PORT,
    dataDir: path.resolve(API_ROOT, env.DATA_DIR),
    agents: {
      grokApiKey: env.XAI_API_KEY,
      models: {
        browse: env.GROK_MODEL_RECOLHA ?? DEFAULT_MODEL,
        compare: env.GROK_MODEL_COMPARACAO ?? DEFAULT_MODEL,
      },
      googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
      tavilyApiKey: env.TAVILY_API_KEY,
      offline,
      maxSteps: env.AGENT_MAX_STEPS,
      cacheDir: path.resolve(API_ROOT, env.CACHE_DIR),
      skillsDir: path.resolve(API_ROOT, env.SKILLS_DIR),
    },
  }
}
