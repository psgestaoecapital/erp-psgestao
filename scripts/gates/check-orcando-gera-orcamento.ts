/**
 * Gate de build · Tryo #263: "ao colocar a oportunidade em Orçamento, a lista de orçamentos não atualiza". Só o arrastar
 * no kanban gerava o orçamento; pelo seletor de Etapa do formulário o card ia para "Orçando" sem orçamento (Tryo: 12 em
 * Orçando, 1 com orçamento). Agora salvar em "Orçando" gera pela mesma RPC idempotente.
 *   tsx scripts/check-orcando-gera-orcamento.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const form = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadeFormModal.tsx', 'utf8')
ok(/if \(form\.etapa !== 'orcando'\) return undefined/.test(form) && /rpc\('fn_oportunidade_gerar_orcamento', \{ p_oportunidade_id: id \}\)/.test(form),
  'salvar em "Orçando" gera o orçamento pela RPC oficial')
ok((form.match(/await garantirOrcamento\(/g) ?? []).length === 2, 'vale na criação e na edição')
ok(/onSaved\(initial\.id, avisoOrc\)/.test(form) && /onSaved\(novoId, avisoOrc\)/.test(form), 'o aviso (criado / não gerado) chega à tela')

const kanban = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadesKanban.tsx', 'utf8')
ok(/rpc\('fn_oportunidade_gerar_orcamento', \{ p_oportunidade_id: cardId \}\)/.test(kanban), 'o arrastar para "Orçando" continua gerando')
ok(/card\?\.cliente \|\| card\?\.titulo/.test(kanban) && !/cliente_nome\?: string/.test(kanban), 'a confirmação do arrastar usa o nome do cliente (campo certo)')

const form263 = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadeFormModal.tsx', 'utf8')
ok(/setF\('etapa', e\.target\.value\)\} style=\{inp\} data-testid="oport-etapa"/.test(form263), 'o seletor de Etapa do formulário tem testid próprio (a página atrás tem um filtro com as mesmas opções)')

if (falhas > 0) { console.error(`\n[check-orcando-gera-orcamento] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-orcando-gera-orcamento] "Orçando" gera orçamento pelos dois caminhos.')
