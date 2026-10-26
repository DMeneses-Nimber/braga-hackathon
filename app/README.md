# Interface do Data Integrity Agent

React 19 com Vite, Tailwind CSS e ícones Lucide. A interface só fala com a API, em `/api`. No cabeçalho vê-se se os agentes estão ligados. Quando não estão, «Verificar empresa» fica desativado e um aviso diz qual é a chave em falta.

## Arrancar

Em desenvolvimento, a API e a interface correm em dois terminais. O Vite reencaminha `/api` para a porta 3000. Se a API não estiver a correr, a interface diz para a arrancar.

Para a demonstração chega um servidor: compilar a interface e depois arrancar a API, que serve as duas coisas na porta 3000.

```bash
# terminal 1
cd api
npm run dev

# terminal 2
cd app
npm run dev
```

A interface fica em http://localhost:5173. Com a API a servir a compilação, fica em http://localhost:3000.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento do Vite, na porta 5173 |
| `npm run build` | Verifica os tipos e compila para `dist/` |
| `npm run preview` | Serve a compilação |
| `npm run typecheck` | Só verifica os tipos |

## Ecrãs

| Rota | O que mostra |
| --- | --- |
| `/` | Totais, o interruptor da verificação semanal (com confirmação antes de ligar) e a tabela de empresas, com pesquisa. |
| `/empresas/:nif` | Os dados guardados, «Verificar empresa» com os passos dos agentes em direto, o resultado, as propostas e a evidência. A evidência só inclui campos com propostas (pendentes ou já revistas) e só as fontes que encontraram alguma coisa; o cabeçalho de cada campo diz quantas foram pesquisadas. Se a verificação falhar, os passos que já apareceram ficam no ecrã. |
| `/propostas` | Todas as propostas, filtradas por pendentes, aprovadas, rejeitadas ou todas, com aprovar e rejeitar. |
| `/resultados` | A avaliação. Enquanto a API responde 501, mostra o lugar reservado. |

O nome escrito no canto superior direito entra em cada aprovação e rejeição e fica guardado no browser.

## Código

| Ficheiro | Conteúdo |
| --- | --- |
| `src/api.ts` | O cliente da API, os erros e o fluxo NDJSON. Os tipos vêm dos esquemas da API, por isso a verificação de tipos também precisa dos pacotes instalados em `api/`. |
| `src/data.tsx` | O estado partilhado: o contador que recarrega as listas e o nome de quem revê. |
| `src/components/` | Os blocos de interface, o cabeçalho, os cartões de proposta, os diálogos, a evidência, a verificação e a ronda semanal. |
| `src/pages/` | Os quatro ecrãs e a página não encontrada. |
| `src/index.css` | O Tailwind, as cores e o modo escuro, que segue o sistema. |
