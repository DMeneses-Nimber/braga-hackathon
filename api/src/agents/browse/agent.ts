import {
  APICallError,
  RetryError,
  ToolChoiceViolationError,
  generateText,
  hasToolCall,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
} from 'ai'
import { z } from 'zod'

import { FIELDS, SOURCES, type Company, type Field, type Source } from '../../schemas/index.js'
import type { AgentContext, BrowseResult } from '../types.js'
import { hostOf, type SourceCatalog } from '../sources.js'
import { SourceRegistry, verifyEvidence, type EvidenceInput } from './proof.js'
import type { SourceTools } from './tools/index.js'

/** Calls allowed per verification for the paid or rationed tools. */
export interface ToolLimits {
  googleMaps: number
  webSearch: number
}

/** What one collection agent is built from. */
export interface BrowseAgentOptions {
  model: LanguageModel
  fallbackModel?: LanguageModel
  instructions: string
  sources: SourceCatalog
  tools: SourceTools
  maxSteps: number
  limits?: Partial<ToolLimits>
}

interface Consultation {
  fields: Field[]
  urls: string[]
  domains?: string[]
  source?: Source
  failure?: { error: string; transient?: boolean }
}

interface RunState {
  registry: SourceRegistry
  consultations: Consultation[]
  redirectHosts: Set<string>
  delivered?: EvidenceInput[]
  maps: number
  searches: number
}

const campos = z
  .array(z.enum(FIELDS))
  .min(1)
  .describe('Os campos que procuras nesta consulta: address, cae, site ou status.')

/** The collection agent: Grok reads the sources, then the code keeps only what a tool really returned. */
export function createBrowseAgent(options: BrowseAgentOptions) {
  const limits: ToolLimits = {
    googleMaps: options.limits?.googleMaps ?? 2,
    webSearch: options.limits?.webSearch ?? 4,
  }
  return {
    async collect(company: Company, context: AgentContext): Promise<BrowseResult> {
      try {
        return await run(company, context, options, limits, options.model)
      } catch (error) {
        // Only this company switches; the next one starts again with the usual model.
        if (!options.fallbackModel || context.signal.aborted || !isHighDemand(error)) throw error
        context.log(
          `O modelo ${modelId(options.model)} está com muita procura; esta empresa segue com ${modelId(options.fallbackModel)}.`,
        )
        return run(company, context, options, limits, options.fallbackModel)
      }
    },
  }
}

async function run(
  company: Company,
  context: AgentContext,
  options: BrowseAgentOptions,
  limits: ToolLimits,
  model: LanguageModel,
): Promise<BrowseResult> {
  const state: RunState = {
    registry: new SourceRegistry(),
    consultations: [],
    redirectHosts: new Set(),
    maps: 0,
    searches: 0,
  }
  const storedHost = company.site ? hostOf(company.site) : undefined
  const tools = buildTools(context, options.tools, limits, state, storedHost)
  const prompt = [
    'Empresa a verificar:',
    `- Nome: ${company.casualName} (${company.name})`,
    `- NIF: ${company.nif}`,
    `- Morada guardada: ${company.address ?? '(sem valor)'}`,
    `- Website guardado: ${company.site ?? '(sem valor)'}`,
    `- CAE guardada: ${company.cae ?? '(sem valor)'}`,
    `- Estado guardado: ${company.status}`,
    '',
    `Ferramentas disponíveis nesta verificação: ${Object.keys(tools).join(', ')}.`,
    'Recolhe evidência para a morada, a CAE, o website e o estado, e termina com entregarEvidencias.',
  ].join('\n')

  const result = await generateText({
    model,
    instructions: options.instructions,
    prompt,
    tools,
    toolChoice: 'auto',
    stopWhen: [hasToolCall('entregarEvidencias'), stepCountIs(options.maxSteps)],
    prepareStep: ({ stepNumber }) => {
      // The last allowed step must hand the evidence over.
      if (stepNumber >= options.maxSteps - 1) return { toolChoice: { type: 'tool', toolName: 'entregarEvidencias' } }
      return undefined
    },
    abortSignal: context.signal,
  })

  if (state.delivered === undefined) {
    const reason = result.rawFinishReason ?? result.finishReason
    context.log(`O agente parou sem entregar a evidência (${reason}); a pedir a entrega.`)
    const messages: ModelMessage[] = [
      { role: 'user', content: prompt },
      // Each step only holds its own messages.
      ...result.steps.flatMap((step) => step.response.messages),
      { role: 'user', content: 'Entrega agora, com entregarEvidencias, a evidência que as ferramentas devolveram.' },
    ]
    try {
      await generateText({
        model,
        instructions: options.instructions,
        messages,
        tools: { entregarEvidencias: tools.entregarEvidencias },
        toolChoice: { type: 'tool', toolName: 'entregarEvidencias' },
        abortSignal: context.signal,
      })
    } catch (error) {
      if (!ToolChoiceViolationError.isInstance(error)) throw error
    }
    if (state.delivered === undefined) context.log('O agente terminou sem entregar evidência.')
  }

  // The stored site, the hosts it redirects to, and a host another source names as the website.
  // A page can't vouch for itself.
  const siteHosts = new Set<string>()
  for (const item of state.delivered ?? []) {
    if (item.field !== 'site' || !state.registry.contains(item.url, item.extractProof)) continue
    const valueHost = hostOf(item.value)
    if (valueHost && valueHost !== hostOf(item.url)) siteHosts.add(valueHost)
  }
  const companyHosts = new Set<string>([...state.redirectHosts, ...siteHosts])
  if (storedHost && (siteHosts.size === 0 || siteHosts.has(storedHost))) companyHosts.add(storedHost)

  const evidence =
    state.delivered === undefined
      ? []
      : verifyEvidence(state.delivered, {
          registry: state.registry,
          catalog: options.sources,
          companyHosts,
          log: context.log,
        })
  if (state.delivered !== undefined) {
    context.log(`${evidence.length} de ${state.delivered.length} evidências confirmadas nas fontes.`)
  }
  return { evidence, searches: searchesOf(state, options.sources, companyHosts, evidence) }
}

function buildTools(
  context: AgentContext,
  readers: SourceTools,
  limits: ToolLimits,
  state: RunState,
  storedHost: string | undefined,
) {
  const blocked = (error: string) => ({ ok: false as const, error })
  return {
    abrirPagina: tool({
      description: 'Abre uma página e devolve o título, os dados estruturados, o texto, os links para contactos e o URL final.',
      inputSchema: z.object({
        url: z.string().describe('O endereço completo, com http:// ou https://.'),
        campos,
      }),
      execute: async ({ url, campos: fields }, { abortSignal }) => {
        context.log(`A abrir ${url}.`)
        const consultation = begin(state, fields)
        const page = await readers.page(url, abortSignal)
        if (!page.ok) {
          context.log(`Não abriu: ${page.error}`)
          consultation.urls = [url]
          consultation.failure = { error: page.error, transient: page.transient }
          return page
        }
        consultation.urls = [...new Set([url, page.finalUrl])]
        const content = {
          title: page.title,
          description: page.description,
          structuredData: page.structuredData,
          text: page.text,
          finalUrl: page.finalUrl,
        }
        for (const address of consultation.urls) state.registry.add(address, content)
        const asked = hostOf(url)
        const finalHost = hostOf(page.finalUrl)
        if (asked && storedHost && asked === storedHost && finalHost && finalHost !== asked) {
          state.redirectHosts.add(finalHost)
          context.log(`O site guardado redireciona para ${page.finalUrl}.`)
        }
        return page
      },
    }),
    sicae: tool({
      description: 'Consulta no SICAE a CAE principal e as secundárias de uma entidade, pelo NIPC.',
      inputSchema: z.object({ nipc: z.string().regex(/^\d{9}$/).describe('O NIF de 9 dígitos.') }),
      execute: async ({ nipc }, { abortSignal }) => {
        context.log(`A consultar o SICAE (NIPC ${nipc}).`)
        const result = await readers.sicae(nipc, abortSignal)
        const consultation = begin(state, ['cae'])
        consultation.urls = result.url ? [result.url] : []
        if (!result.ok) {
          consultation.failure = { error: result.error, transient: result.transient }
          context.log(`SICAE: ${result.error}`)
        } else {
          state.registry.add(result.url, result)
        }
        return result
      },
    }),
    contribuinte: tool({
      description: 'Consulta no contribuinte.pt a morada, o estado e a CAE de uma empresa, pelo NIF.',
      inputSchema: z.object({
        nif: z.string().regex(/^\d{9}$/).describe('O NIF de 9 dígitos.'),
        campos,
      }),
      execute: async ({ nif, campos: fields }, { abortSignal }) => {
        context.log(`A consultar o contribuinte.pt (NIF ${nif}).`)
        const result = await readers.contribuinte(nif, abortSignal)
        const consultation = begin(state, fields)
        consultation.urls = [result.url]
        if (!result.ok) {
          consultation.failure = { error: result.error, transient: result.transient }
          context.log(`contribuinte.pt: ${result.error}`)
        } else {
          state.registry.add(result.url, result)
        }
        return result
      },
    }),
    wikipedia: tool({
      description: 'Procura a empresa na Wikipedia em português e devolve a sede e o website da infocaixa.',
      inputSchema: z.object({
        nome: z.string().min(2).describe('O nome da empresa.'),
        campos,
      }),
      execute: async ({ nome, campos: fields }, { abortSignal }) => {
        context.log(`A procurar na Wikipedia: ${nome}.`)
        const result = await readers.wikipedia(nome, abortSignal)
        const consultation = begin(state, fields)
        consultation.urls = [result.url]
        if (!result.ok) {
          consultation.failure = { error: result.error, transient: result.transient }
          context.log(`Wikipedia: ${result.error}`)
        } else {
          state.registry.add(result.url, result)
        }
        return result
      },
    }),
    ...(readers.googleMaps
      ? {
          googleMaps: tool({
            description: 'Procura a empresa no Google Maps e devolve a morada, o website e o estado do local.',
            inputSchema: z.object({
              texto: z.string().min(2).describe('O nome da empresa e a localidade.'),
              campos,
            }),
            execute: async ({ texto, campos: fields }, { abortSignal }) => {
              if (state.maps >= limits.googleMaps) {
                return blocked('Limite de pesquisas no Google Maps atingido nesta verificação.')
              }
              state.maps += 1
              context.log(`A procurar no Google Maps: ${texto}.`)
              const reader = readers.googleMaps
              if (!reader) return blocked('Limite de pesquisas no Google Maps atingido nesta verificação.')
              const result = await reader(texto, abortSignal)
              const consultation = begin(state, fields)
              consultation.source = 'googleMaps'
              if (!result.ok) {
                consultation.failure = { error: result.error, transient: result.transient }
                context.log(`Google Maps: ${result.error}`)
                return result
              }
              consultation.urls = result.places.map((place) => place.url)
              for (const place of result.places) state.registry.add(place.url, place)
              return result
            },
          }),
        }
      : {}),
    ...(readers.webSearch
      ? {
          pesquisarWeb: tool({
            description: 'Pesquisa na web. Com domínios (por exemplo linkedin.com ou teamlyzer.com), só nesses sites.',
            inputSchema: z.object({
              consulta: z.string().min(2).describe('O que pesquisar, normalmente o nome da empresa.'),
              dominios: z.array(z.string()).describe('Domínios a que a pesquisa se limita; vazio para a web toda.'),
              campos,
            }),
            execute: async ({ consulta, dominios, campos: fields }) => {
              if (state.searches >= limits.webSearch) {
                return blocked('Limite de pesquisas na web atingido nesta verificação.')
              }
              state.searches += 1
              const domains = dominios.map((domain) => domain.trim()).filter((domain) => domain.length > 0)
              context.log(
                domains.length > 0
                  ? `A pesquisar na web: ${consulta} (${domains.join(', ')}).`
                  : `A pesquisar na web: ${consulta}.`,
              )
              const reader = readers.webSearch
              if (!reader) return blocked('Limite de pesquisas na web atingido nesta verificação.')
              const result = await reader(consulta, domains)
              const consultation = begin(state, fields)
              consultation.domains = domains
              if (domains.length === 0) consultation.source = 'web'
              if (!result.ok) {
                consultation.failure = { error: result.error, transient: result.transient }
                context.log(`Pesquisa web: ${result.error}`)
                return result
              }
              consultation.urls = result.results.map((item) => item.url)
              for (const item of result.results) state.registry.add(item.url, item)
              return result
            },
          }),
        }
      : {}),
    entregarEvidencias: tool({
      description: 'Entrega a evidência recolhida e termina a recolha.',
      inputSchema: z.object({
        evidencias: z.array(
          z.object({
            field: z.enum(FIELDS).describe('O campo: address, cae, site ou status.'),
            value: z.string().min(1).describe('O valor como aparece na fonte.'),
            source: z.enum(SOURCES).describe('A fonte da evidência.'),
            url: z.string().min(1).describe('O URL exato que a ferramenta devolveu.'),
            extractProof: z.string().min(1).describe('Excerto copiado letra a letra do resultado da ferramenta.'),
          }),
        ),
      }),
      execute: async ({ evidencias }) => {
        state.delivered = evidencias
        return { recebidas: evidencias.length }
      },
    }),
  }
}

function begin(state: RunState, fields: Field[]): Consultation {
  const consultation: Consultation = { fields, urls: [] }
  state.consultations.push(consultation)
  return consultation
}

interface SearchEntry {
  field: Field
  source: Source
  urls: string[]
  found: boolean
  answered: boolean
  failureNote: string | null
  emptyNote: string | null
}

function searchesOf(
  state: RunState,
  catalog: SourceCatalog,
  companyHosts: ReadonlySet<string>,
  evidence: EvidenceInput[],
): BrowseResult['searches'] {
  const order: SearchEntry[] = []
  const entries = new Map<string, SearchEntry>()
  const entry = (field: Field, source: Source): SearchEntry => {
    const key = `${field}:${source}`
    const current = entries.get(key)
    if (current) return current
    const created: SearchEntry = {
      field,
      source,
      urls: [],
      found: false,
      answered: false,
      failureNote: null,
      emptyNote: null,
    }
    entries.set(key, created)
    order.push(created)
    return created
  }
  const addUrl = (item: SearchEntry, url: string): void => {
    if (item.urls.length < 5 && !item.urls.includes(url)) item.urls.push(url)
  }

  for (const consultation of state.consultations) {
    const pages = consultation.urls
      .filter((url) => /^https?:\/\//i.test(url))
      .flatMap((url) => {
        const source = catalog.fromUrl(url, companyHosts)
        return source ? [{ url, source }] : []
      })
    const sources: Source[] = []
    const addSource = (source: Source | undefined): void => {
      if (source && !sources.includes(source)) sources.push(source)
    }
    for (const page of pages) addSource(page.source)
    for (const domain of consultation.domains ?? []) addSource(catalog.fromUrl(domain, companyHosts))
    addSource(consultation.source)
    for (const field of consultation.fields) {
      for (const source of sources) {
        const item = entry(field, source)
        for (const page of pages) {
          if (page.source === source) addUrl(item, page.url)
        }
        if (consultation.failure?.transient) {
          if (!item.failureNote) item.failureNote = consultation.failure.error
        } else {
          item.answered = true
          if (consultation.failure && !item.emptyNote) item.emptyNote = consultation.failure.error
        }
      }
    }
  }

  for (const item of evidence) {
    const found = entry(item.field, item.source)
    found.found = true
    addUrl(found, item.url)
  }

  return order.map((item) => ({
    field: item.field,
    source: item.source,
    outcome: item.found ? 'encontrado' : item.answered ? 'nada' : 'falhou',
    urls: item.urls,
    note: item.found ? null : item.answered ? item.emptyNote : item.failureNote,
  }))
}

function isHighDemand(error: unknown): boolean {
  const inner = RetryError.isInstance(error) ? error.lastError : error
  if (!APICallError.isInstance(inner)) return false
  if (inner.statusCode === 503 || inner.statusCode === 429) return true
  const message = inner.message.toLowerCase()
  return message.includes('high demand') || message.includes('overloaded')
}

function modelId(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId
}
