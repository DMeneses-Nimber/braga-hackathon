# API do Data Integrity Agent

A API é Hono com validação Zod sobre ficheiros JSON. Dois agentes Grok (recolha e comparação) verificam a morada, a CAE, o website e o estado de cada empresa. Sem a chave do Grok, a verificação responde 501. `GET /avaliacao` responde 501 até existirem os agentes e as referências.

Tudo o que a API escreve fica em `data/runtime/` e em `data/summary/summary.json`. O ficheiro de referência `data/companies/companies.json` nunca é alterado.

## Arrancar

Na pasta `api/`:

```bash
npm install
cp .env.example .env
npm run db:seed
npm run dev
```

O `db:seed` é opcional: repõe a cópia de trabalho a partir de `caso_todos_combinados` e deixa três propostas de exemplo. Na primeira arranque a API cria `data/runtime/` (empresas, evidência, pesquisas e horário) se ainda não existir.

A API também serve a interface compilada. Se existir `app/dist/index.html`, os caminhos fora de `/api` devolvem esses ficheiros, e um GET sem ficheiro devolve `index.html`.

- API: http://localhost:3000/api
- Documentação: http://localhost:3000/api/docs
- Interface, quando compilada: http://localhost:3000

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Arranca `src/index.ts` com o tsx em modo watch |
| `npm run start` | Arranca `src/index.ts` com o tsx |
| `npm run typecheck` | Verifica os tipos com o TypeScript, sem emitir ficheiros |
| `npm test` | Corre o Vitest uma vez |
| `npm run db:reset` | Repõe `data/runtime/` a partir de um conjunto de dados (`companies` por omissão, ou o nome de um ficheiro em `data/tests/input/` sem `.json`) |
| `npm run db:seed` | Repõe `caso_todos_combinados` e cria três propostas de exemplo, sem consultar a internet |

`npm run agentes:testar` fica reservado ao script dos agentes (parte 3).

## Dados

| Ficheiro | O que guarda |
| --- | --- |
| `data/companies/companies.json` | As 31 empresas revistas à mão. A API só lê. |
| `data/tests/input/*.json` | Sete conjuntos de teste, para o `db:reset`. |
| `data/summary/summary.json` | As propostas, com indentação de 4 espaços. A API cria e atualiza. |
| `data/runtime/companies.json` | Cópia de trabalho. Só uma aprovação altera um campo. |
| `data/runtime/evidence.json` | Evidência da última verificação de cada empresa. |
| `data/runtime/searches.json` | Fontes consultadas na última verificação, encontradas ou não. |
| `data/runtime/schedule.json` | Se a verificação semanal está ligada, a ronda em curso e a última. |
| `data/cache/` | Respostas guardadas das ferramentas e do Grok, para `MODO_OFFLINE=1`. |

A escrita é atómica (ficheiro temporário e rename) e passa por um único cadeado no processo.

## Os agentes

A entrada da API chama `createAgents` com a configuração do ambiente. Sem agentes, `GET /agentes` diz que estão desligados e a verificação responde 501 com o motivo.

- **Recolha.** Lê as fontes de cada campo, por ordem de prioridade, e devolve evidência literal e a lista de pesquisas (encontrado, nada ou falhou).
- **Comparação.** Decide campo a campo entre `manter`, `propor`, `ignorar` e `rever`.
- **Cache.** Com `MODO_OFFLINE=1` os agentes só repetem o que está em `data/cache/`.

`propor` e `rever` viram propostas pendentes. `manter` e `ignorar` não. Uma proposta pendente igual (o mesmo valor novo) não é duplicada. Uma alteração rejeitada não volta a ser proposta durante 14 dias a contar de `verifiedAt`, mesmo escrita de outra forma; a data conta no fuso de Lisboa. Cada verificação tem o limite de 20 minutos. `POST /empresas/{nif}/verificar` devolve o resultado de uma vez. `POST /empresas/{nif}/verificar/stream` devolve a mesma verificação em NDJSON, um passo por linha, e depois o resultado ou o erro. Um NIF inválido, uma empresa desconhecida, agentes desligados ou uma verificação já a decorrer respondem em JSON antes de começar o fluxo.

## Verificação semanal

- Ligar (`PUT /verificacao-semanal` com `{ "enabled": true }`) começa logo a primeira ronda e repete-a todas as semanas, à mesma hora local de Lisboa.
- As empresas são verificadas uma de cada vez, como no botão Verificar empresa, e cada uma consome tokens.
- Desligar deixa terminar a empresa em curso e pára a ronda. A ronda fica marcada como interrompida.
- Uma empresa que falhe não pára a ronda: o erro fica na lista de falhas.
- Uma empresa que já esteja a ser verificada pelo botão é saltada.
- Se o processo reiniciar a meio de uma ronda, a ronda guardada continua nas empresas que faltam.
- Com os agentes desligados, ligar a verificação semanal responde 501.

## Código

| Pasta | Conteúdo |
| --- | --- |
| `src/schemas/` | O contrato Zod partilhado pela API, pelos agentes e pela interface, com metadados OpenAPI. |
| `src/db/` | Leitura e escrita dos JSON. |
| `src/services/` | Empresas, verificação, revisão e ronda semanal. |
| `src/routes/` | Endpoints. O fluxo NDJSON não entra no OpenAPI. |
| `src/agents/` | O contrato dos agentes nesta parte; a implementação chega na parte 3. |
| `src/scripts/` | `db:reset` e `db:seed`. |
| `test/` | Testes com pastas temporárias. Não tocam em `data/`. |

## Configuração

As variáveis vivem em `api/.env`. Um valor vazio conta como omisso. Os caminhos relativos resolvem-se a partir da pasta `api/`, não a partir de onde o comando corre.

| Variável | Omissão | Efeito |
| --- | --- | --- |
| `PORT` | 3000 | Porta HTTP, de 1 a 65535. |
| `DATA_DIR` | `../data` | Pasta dos dados. |
| `XAI_API_KEY` | — | Sem ela os agentes ficam desligados. |
| `GROK_MODEL_RECOLHA` | `grok-4.7` | Modelo do agente de recolha. |
| `GROK_MODEL_COMPARACAO` | `grok-4.7` | Modelo do agente de comparação. |
| `GOOGLE_MAPS_API_KEY` | — | Places API New: morada, website e estado. |
| `TAVILY_API_KEY` | — | Pesquisa web restrita a LinkedIn, redes sociais e Teamlyzer. |
| `MODO_OFFLINE` | desligado | `1`, `true` ou `sim` usam só `data/cache/`. |
| `AGENT_MAX_STEPS` | 16 | Passos do agente de recolha, de 4 a 40. |
| `CACHE_DIR` | `../data/cache` | Pasta da cache dos agentes. |
| `SKILLS_DIR` | `../.agents/skills` | Pasta das skills dos agentes. |

No Windows, o curl do Git Bash envia texto acentuado na página de códigos da consola. Os acentos devem ser experimentados pelo Swagger, em `/api/docs`.
