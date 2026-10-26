import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { LanguageModelMiddleware } from 'ai'

import { writeJsonFile } from '../db/json-file.js'

/** Thrown when offline mode has no saved answer for a request. */
export class OfflineCacheMiss extends Error {
  constructor(kind: string) {
    super(`O modo offline está ligado e não há resposta guardada para este pedido (${kind}).`)
    this.name = 'OfflineCacheMiss'
  }
}

interface Saved<T> {
  kind: string
  key: unknown
  savedAt: string
  value: T
}

/**
 * Saves what the tools and Grok answer, keyed by a hash of the request, so each request is made once.
 * In offline mode only the cache answers, so the demo replays earlier verifications without internet.
 */
export class AgentCache {
  private readonly folder: string
  private readonly offline: boolean

  constructor(folder: string, offline: boolean) {
    this.folder = folder
    this.offline = offline
  }

  /**
   * Returns the saved value, or runs the loader and saves it.
   * `keep` decides whether a value is worth saving; a timeout isn't.
   */
  async remember<T>(
    kind: string,
    key: unknown,
    load: () => PromiseLike<T>,
    keep: (value: T) => boolean = () => true,
  ): Promise<T> {
    const file = this.fileFor(kind, key)
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as Saved<T>
      return saved.value
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') throw error
    }
    if (this.offline) throw new OfflineCacheMiss(kind)
    const value = await load()
    if (keep(value)) {
      await writeJsonFile(file, { kind, key, savedAt: new Date().toISOString(), value })
    }
    return value
  }

  /** Caches every Grok call under the kind "grok". */
  middleware(): LanguageModelMiddleware {
    return {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate, params, model }) => {
        const key = {
          modelId: model.modelId,
          prompt: params.prompt,
          tools: params.tools,
          toolChoice: params.toolChoice,
          responseFormat: params.responseFormat,
          providerOptions: params.providerOptions,
        }
        return this.remember('grok', key, () => doGenerate())
      },
    }
  }

  private fileFor(kind: string, key: unknown): string {
    const hash = createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 32)
    return path.join(this.folder, kind, `${hash}.json`)
  }
}
