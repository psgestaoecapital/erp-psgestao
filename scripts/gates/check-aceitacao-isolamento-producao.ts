// Gate (incidente 13/10) — ISOLAMENTO DE PRODUÇÃO (Pilar 2). Uma spec de aceitação do despertador/caixa gravava na
// caixa de agentes (erp_agente_mensagem) com o service_role de PRODUÇÃO e não limpava: 2.922 mensagens "[TESTE …]"
// soterraram as caixas reais do gilberto-chamados (2.620) e do andre-code (302), escondendo 27 tarefas reais de cliente.
//
// erp_agente_mensagem é tabela GLOBAL (sem isolamento por empresa): não há como gravá-la em produção sem tocar a caixa
// real. Regra: QUALQUER spec de e2e/jornadas/aceitacao que ENVIE para a caixa de um agente REAL tem de pular em produção
// (test.skip(IS_PROD, …)) — prova só no banco de testes da vaga. Sem rede; só leitura estática dos arquivos.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const DIR = 'e2e/jornadas/aceitacao'
// Agentes REAIS (caixa de verdade). O agente de TESTE dedicado (teste-despertador) e variáveis (AG, AGENTE_TESTE) não contam.
const AGENTES_REAIS = [
  'gilberto-desenv', 'gilberto-chamados', 'gilberto-produto', 'gilberto-automotivo', 'gilberto-industria',
  'rodrigo-code', 'jordana-code', 'andre-code', 'stephany-code', 'gilberto-revisor', 'gilberto-chat',
]

// 1) A detecção central de produção existe em api.ts (todas as specs usam a mesma fonte de verdade).
const api = readFileSync('e2e/support/api.ts', 'utf8')
ok(/export const IS_PROD\b/.test(api) && /horsymhsinqcimflrtjo/.test(api),
  'api.ts exporta IS_PROD ancorado no ref da produção (horsymhsinqcimflrtjo)')

// 2) Nenhuma spec de aceitação envia para a caixa de um agente REAL sem a guarda de produção.
//    "Envia para a caixa" = fn_agente_mensagem_enviar / fn_agente_pedido_enviar, insert direto em erp_agente_mensagem,
//    POST cru em /rest/v1/erp_agente_mensagem, ou o helper local enviar('<agente>').
const escreveCaixa = (src: string): boolean =>
  /fn_agente_mensagem_enviar/.test(src) ||
  /fn_agente_pedido_enviar/.test(src) ||
  /dbInsert\s*\(\s*['"]erp_agente_mensagem/.test(src) ||
  /\/rest\/v1\/erp_agente_mensagem['"`][\s\S]{0,200}method:\s*['"]POST/.test(src)

// alvo REAL = o agente aparece como DESTINO de uma escrita (p_para/para: '<real>' ou enviar('<real>')), não só citado em comentário
const miraAgenteReal = (src: string): string[] =>
  AGENTES_REAIS.filter((a) =>
    new RegExp(`(?:p_para|para)\\s*:\\s*['"]${a}['"]`).test(src) ||
    new RegExp(`enviar\\(\\s*['"]${a}['"]`).test(src))

const temGuardaProducao = (src: string): boolean =>
  /test\.skip\(\s*(IS_PROD|PRODUCAO)\b/.test(src) || /\bif\s*\(\s*(IS_PROD|PRODUCAO)\s*\)\s*return/.test(src)

for (const f of readdirSync(DIR).filter((n) => n.endsWith('.spec.ts'))) {
  const src = readFileSync(`${DIR}/${f}`, 'utf8')
  if (!escreveCaixa(src)) continue
  const reais = miraAgenteReal(src)
  if (reais.length === 0) continue // só escreve na caixa do agente de teste dedicado → ok
  ok(temGuardaProducao(src),
    `${f}: escreve na caixa de agente REAL (${reais.join(', ')}) → precisa pular em produção (test.skip(IS_PROD, …))`)
}

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — isolamento de produção da caixa de agentes`); process.exit(1) }
console.log('\ncheck-aceitacao-isolamento-producao: ok')
