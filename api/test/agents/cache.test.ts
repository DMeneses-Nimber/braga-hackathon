import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { generateText, wrapLanguageModel } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentCache, OfflineCacheMiss } from '../../src/agents/cache.js'
import { textReply } from './support.js'

const folders: string[] = []

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function folder(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'dia-cache-'))
  folders.push(created)
  return created
}

describe('the agent cache', () => {
  it('asks each source once per request and saves the answer by kind', async () => {
    const dir = await folder()
    const cache = new AgentCache(dir, false)
    let calls = 0
    const load = async () => {
      calls += 1
      return { ok: true as const, cae: '53100' }
    }
    await expect(cache.remember('sicae', '500077568', load)).resolves.toEqual({ ok: true, cae: '53100' })
    await expect(cache.remember('sicae', '500077568', load)).resolves.toEqual({ ok: true, cae: '53100' })
    expect(calls).toBe(1)
    const saved = await readdir(path.join(dir, 'sicae'))
    expect(saved).toHaveLength(1)
  })

  it("doesn't save what keep turns down, like a timeout", async () => {
    const cache = new AgentCache(await folder(), false)
    let calls = 0
    const load = async () => {
      calls += 1
      return { ok: false as const, transient: true }
    }
    const keep = (value: { transient?: boolean }) => value.transient !== true
    await cache.remember('sicae', '500077568', load, keep)
    await cache.remember('sicae', '500077568', load, keep)
    expect(calls).toBe(2)
  })

  it('answers only from what was saved in offline mode', async () => {
    const dir = await folder()
    const online = new AgentCache(dir, false)
    await online.remember('sicae', '500077568', async () => 'guardado')
    const offline = new AgentCache(dir, true)
    let calls = 0
    await expect(offline.remember('sicae', '500077568', async () => {
      calls += 1
      return 'novo'
    })).resolves.toBe('guardado')
    await expect(offline.remember('sicae', '505060515', async () => 'novo')).rejects.toBeInstanceOf(OfflineCacheMiss)
    expect(calls).toBe(0)
  })

  it('replays Grok answers through the middleware, also offline', async () => {
    const dir = await folder()
    let calls = 0
    const onlineModel = new MockLanguageModelV4({
      modelId: 'grok-teste',
      doGenerate: async () => {
        calls += 1
        return textReply('Olá')
      },
    })
    const online = wrapLanguageModel({ model: onlineModel, middleware: new AgentCache(dir, false).middleware() })
    await expect(generateText({ model: online, prompt: 'Diz olá' })).resolves.toMatchObject({ text: 'Olá' })
    await expect(generateText({ model: online, prompt: 'Diz olá' })).resolves.toMatchObject({ text: 'Olá' })
    expect(calls).toBe(1)

    const offlineModel = new MockLanguageModelV4({
      modelId: 'grok-teste',
      doGenerate: async () => {
        throw new Error('Sem internet')
      },
    })
    const offline = wrapLanguageModel({ model: offlineModel, middleware: new AgentCache(dir, true).middleware() })
    await expect(generateText({ model: offline, prompt: 'Diz olá' })).resolves.toMatchObject({ text: 'Olá' })
    await expect(generateText({ model: offline, prompt: 'Outra pergunta', maxRetries: 0 })).rejects.toThrow(/offline/)
  })
})
