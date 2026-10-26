import path from 'node:path'
import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { API_ROOT, loadConfig } from './config.js'
import { createAgents } from './agents/index.js'

const config = loadConfig()
const { agents, status } = await createAgents(config.agents)
// After building the app, the API also serves the interface.
const appDir = path.resolve(API_ROOT, '../app/dist')
const staticDir = existsSync(path.join(appDir, 'index.html')) ? appDir : undefined
const { app, db, weekly } = await createApp({
  dataDir: config.dataDir,
  logRequests: true,
  staticDir,
  agents,
  agentsStatus: status,
})
const weeklyStatus = await weekly.status()

serve({ fetch: app.fetch, port: config.port }, () => {
  const port = config.port
  console.log(`API do Data Integrity Agent em http://localhost:${port}/api`)
  console.log(`Documentação: http://localhost:${port}/api/docs`)
  if (staticDir) console.log(`Interface: http://localhost:${port}`)
  console.log(`Empresas e evidência: ${db.paths.runtime}`)
  console.log(`Propostas: ${db.paths.proposals}`)
  if (status.enabled) {
    console.log(`Agentes ligados: ${status.models.browse} (recolha), ${status.models.compare} (comparação)`)
    const tools = [
      status.tools.googleMaps ? 'Google Maps' : undefined,
      status.tools.webSearch ? 'pesquisa web' : undefined,
    ].filter((item): item is string => item !== undefined)
    const list = tools.length > 0 ? tools.join(', ') : 'nenhuma (falta a chave do Google Maps e da Tavily)'
    console.log(`Ferramentas extra: ${list}`)
    if (status.reason) console.log(status.reason)
  } else {
    console.log(`Agentes desligados: ${status.reason}`)
  }
  if (!weeklyStatus.enabled) {
    console.log('Verificação semanal: desligada (liga-se na página das empresas).')
  } else if (weeklyStatus.running) {
    console.log('Verificação semanal: ligada, a retomar a ronda que ficou a meio.')
  } else if (weeklyStatus.nextRunAt) {
    console.log(
      `Verificação semanal: ligada, próxima ronda em ${new Date(weeklyStatus.nextRunAt).toLocaleString('pt-PT')}.`,
    )
  }
})
