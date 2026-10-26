import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { body, createDataDir, CTT, setup, type Json, type TestContext } from './helpers.js'

describe('the API around the endpoints', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
    ctx = undefined
  })

  it('GET /api/avaliacao answers 501 for now', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/avaliacao')
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(501)
    expect(payload.error.code).toBe('AVALIACAO_INDISPONIVEL')
  })

  it('publishes an OpenAPI spec with every route', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/openapi.json')
    const spec = (await body(response)) as { servers: { url: string }[]; paths: Record<string, Json> }
    expect(response.status).toBe(200)
    expect(spec.servers).toEqual([{ url: '/api' }])
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/agentes',
      '/avaliacao',
      '/empresas',
      '/empresas/{nif}',
      '/empresas/{nif}/verificar',
      '/propostas',
      '/propostas/{id}/aprovar',
      '/propostas/{id}/rejeitar',
      '/verificacao-semanal',
    ])
  })

  it('serves Swagger UI at /api/docs', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/docs')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('answers JSON 404 for an unknown route', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/nada')
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('ROTA_NAO_ENCONTRADA')
  })

  it('names the file when a data file is broken', async () => {
    ctx = await setup()
    await writeFile(ctx.db.paths.proposals, '{ not json', 'utf8')
    const response = await ctx.app.request('/api/propostas')
    const payload = (await body(response)) as { error: { code: string; details: { file: string } } }
    expect(response.status).toBe(500)
    expect(payload.error.code).toBe('DADOS_INVALIDOS')
    expect(payload.error.details.file).toBe('summary.json')
  })
})

describe('serving the built app', () => {
  it("serves the app's files, and index.html for the app's own pages", async () => {
    const dataDir = await createDataDir()
    const staticDir = await mkdtemp(path.join(os.tmpdir(), 'dia-app-'))
    await writeFile(path.join(staticDir, 'index.html'), '<!DOCTYPE html><title>App</title>', 'utf8')
    await mkdir(path.join(staticDir, 'assets'))
    await writeFile(path.join(staticDir, 'assets', 'app.js'), 'console.log("app")', 'utf8')
    const created = await createApp({ dataDir, staticDir })
    try {
      for (const url of ['/', `/empresas/${CTT}`, '/propostas']) {
        const response = await created.app.request(url)
        expect(response.status).toBe(200)
        expect(await response.text()).toContain('App')
      }
      const asset = await created.app.request('/assets/app.js')
      expect(asset.headers.get('content-type')).toContain('javascript')
      expect(await asset.text()).toContain('console.log("app")')
    } finally {
      created.weekly.dispose()
      await created.weekly.idle()
      await rm(dataDir, { recursive: true, force: true })
      await rm(staticDir, { recursive: true, force: true })
    }
  })

  it('leaves /api to the API, including its JSON 404', async () => {
    const dataDir = await createDataDir()
    const staticDir = await mkdtemp(path.join(os.tmpdir(), 'dia-app-'))
    await writeFile(path.join(staticDir, 'index.html'), '<!DOCTYPE html><title>App</title>', 'utf8')
    const created = await createApp({ dataDir, staticDir })
    try {
      const companies = await created.app.request('/api/empresas')
      expect(companies.status).toBe(200)
      const missing = await created.app.request('/api/nada')
      const payload = (await missing.json()) as { error: { code: string } }
      expect(missing.status).toBe(404)
      expect(payload.error.code).toBe('ROTA_NAO_ENCONTRADA')
    } finally {
      created.weekly.dispose()
      await created.weekly.idle()
      await rm(dataDir, { recursive: true, force: true })
      await rm(staticDir, { recursive: true, force: true })
    }
  })
})
