// Gate (PDCA Hub 24/10, caixa e10ef43c): Visitas técnicas gera o orçamento da visita sem sair da lista (mesma regra da
// ficha da oportunidade: reaproveita o orçamento da oportunidade ou cria em rascunho e vincula) e a semente da DEMO
// grava a visita em horário comercial (não a hora do reset, que mostrava 02:24 em todas).
import { readFileSync, readdirSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FALHA'} ${m}`); if (!c) falhas++ }

const tela = readFileSync('src/app/dashboard/projetos/visitas/page.tsx', 'utf8')
const lib = readFileSync('src/lib/crm/orcamentoDaVisita.ts', 'utf8')
ok(/gerarOrcamentoDaVisita\(r\.id, r\.oportunidade_id\)/.test(tela) && /data-testid="visita-gerar-orcamento"/.test(tela), 'a lista tem "+ Gerar orçamento desta visita"')
ok(/semOrcamento\(r\) && \(/.test(tela) && /confirm\(/.test(tela), 'o botão só aparece na realizada sem orçamento e confirma antes de criar')
ok(/AjudaCampo chave="projetos\.visitas\.acoes"/.test(tela), 'a linha de ações tem o "?" (RD-95)')
ok(/orcamento_id/.test(lib) && /if \(!orcamentoId\)/.test(lib), 'reaproveita o orçamento da oportunidade quando já existe')
ok(/next_orcamento_numero/.test(lib) && /status: 'rascunho'/.test(lib), 'cria o orçamento em rascunho com o número da empresa')
ok(/\.from\('erp_crm_visita'\)\.update\(\{ gerou_orcamento_id: orcamentoId \}\)/.test(lib), 'vincula a visita ao orçamento')
ok(/\.update\(\{ orcamento_id: orcamentoId \}\)/.test(lib) && /'orcando'/.test(lib), 'liga à oportunidade e avança a etapa para orçando')

const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
const mig = migs.find((f) => f.endsWith('_hub_visitas_orcamento_horario_demo.sql'))
ok(!!mig, 'migration do horário das visitas existe')
const sql = mig ? readFileSync(`supabase/migrations/${mig}`, 'utf8') : ''
ok(sql.includes("'SELECT v.id::uuid, c, o.id, now() + v.delta, v.st,'") && /RAISE EXCEPTION/.test(sql), 'patch por âncora na semente, aborta sem a âncora')
ok(/interval ''9 hours''/.test(sql) && /America\/Sao_Paulo/.test(sql), 'semente usa horário comercial no fuso de São Paulo')
ok(/v\.company_id = 'b0700000-0000-4000-a000-000000000006'/.test(sql) && /is_demo IS TRUE/.test(sql), 'acerto das visitas só na DEMO 006 (RD-55)')
ok(/WHERE chave = 'projetos\.visitas\.acoes'/.test(sql), 'texto do "?" das ações cita o botão novo')
if (falhas) process.exit(1)
