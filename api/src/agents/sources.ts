import type { Field, Source } from '../schemas/index.js'
import type { SourcesFile } from './skills.js'

/** Capitalised titles for step messages; the backend's lower-case labels are for use inside sentences. */
export const FIELD_TITLES: Record<Field, string> = {
  address: 'Morada',
  cae: 'CAE',
  site: 'Website',
  status: 'Estado',
}

const FIELD_ORDER: Field[] = ['address', 'cae', 'site', 'status']

/** The host of a URL or bare domain, in lower case, without a leading "www.". */
export function hostOf(value: string): string | undefined {
  const text = value.trim()
  if (text.length === 0) return undefined
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`
  let host: string
  try {
    host = new URL(withScheme).hostname
  } catch {
    return undefined
  }
  host = host.toLowerCase()
  if (host.length === 0) return undefined
  return host.startsWith('www.') ? host.slice(4) : host
}

/** The sources of each field, their labels and which domain belongs to which source. */
export class SourceCatalog {
  readonly file: SourcesFile

  constructor(file: SourcesFile) {
    this.file = file
  }

  /** The source's 1-based position. A source missing from the list ranks with "web". */
  rank(field: Field, source: Source): number {
    const list = this.file.fields[field]
    const index = list.indexOf(source)
    if (index !== -1) return index + 1
    const web = list.indexOf('web')
    return web === -1 ? list.length + 1 : web + 1
  }

  /** The label shown to the model and in step messages. */
  label(source: Source): string {
    return this.file.sources[source].label
  }

  /** The source a URL belongs to. The company's own hosts count as its site. */
  fromUrl(url: string, companyHosts: ReadonlySet<string>): Source | undefined {
    const host = hostOf(url)
    if (host === undefined) return undefined
    if (companyHosts.has(host)) return 'site'
    for (const source of Object.keys(this.file.sources) as Source[]) {
      for (const domain of this.file.sources[source].domains) {
        if (host === domain || host.endsWith(`.${domain}`)) return source
      }
    }
    return 'web'
  }

  /** The text the collection agent reads under "Fontes por campo". */
  describe(): string {
    return FIELD_ORDER.map((field) => {
      const lines = this.file.fields[field].map((source, index) => {
        const entry = this.file.sources[source]
        return `${index + 1}. ${entry.label} (\`${source}\`): ${entry.how}`
      })
      return [`### ${FIELD_TITLES[field]} (\`${field}\`)`, '', ...lines].join('\n')
    }).join('\n\n')
  }
}
