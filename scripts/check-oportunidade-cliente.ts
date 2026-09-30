/**
 * Gate de build · Tryo #110 + #262 (Oportunidades): o cliente identifica o card, o nome digitado sem escolher da lista
 * é gravado (reusa ou cadastra), o telefone do cliente aparece e é gravado no cadastro, e fn_crm_pipeline traz o
 * telefone com guarda por empresa.
 *   tsx scripts/check-oportunidade-cliente.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { telefoneDoCliente, linkTelefone, tituloOportunidade, erroOportunidade } from '../src/lib/crm/oportunidadeCliente'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

ok(telefoneDoCliente({ telefone: '4933331111', celular: ' 49999990000 ', whatsapp: null }) === '49999990000', 'celular vem antes do fixo')
ok(telefoneDoCliente({ telefone: '4933331111', celular: '', whatsapp: '' }) === '4933331111', 'sem celular/WhatsApp usa o fixo')
ok(telefoneDoCliente(null) === '', 'sem cliente, sem telefone')
ok(linkTelefone('(49) 99999-0000') === 'tel:49999990000', 'link de discagem só com dígitos')
ok(linkTelefone('123') === '', 'número curto demais não vira link')
ok(tituloOportunidade('forro de gesso', 'João') === 'FORRO DE GESSO', 'com descrição, o título é a descrição (caixa alta)')
ok(tituloOportunidade('  ', 'Maria Silva') === 'MARIA SILVA', 'sem descrição, o título leva o nome do cliente')
ok(erroOportunidade('', '') !== null, 'sem cliente e sem descrição não salva')
ok(erroOportunidade('', 'Maria') === null && erroOportunidade('forro', '') === null, 'basta o cliente OU a descrição')

const form = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadeFormModal.tsx', 'utf8')
ok(/async function resolverClienteDigitado/.test(form) && /clienteId = await resolverClienteDigitado\(buscaCli\)/.test(form),
  'nome digitado sem escolher da lista é resolvido (reusa ou cadastra) antes de salvar — #262')
ok(/cliente_id: clienteId,/.test(form), 'a oportunidade grava o cliente resolvido')
ok(/update\(\{ \[telCol\]: telCli\.trim\(\) \|\| null \}\)/.test(form), 'telefone editado vai para o cadastro do cliente — #110')
ok(form.indexOf('data-testid="oport-cliente"') < form.indexOf('data-testid="oport-descricao"'), 'o cliente vem antes da descrição no formulário')
ok(!/FIX 1 · título recebe o nome do cliente/.test(form), 'a descrição não é mais sobrescrita com o nome do cliente')

const kanban = readFileSync('src/app/dashboard/projetos/oportunidades/OportunidadesKanban.tsx', 'utf8')
ok(/\{c\.cliente \|\| c\.titulo\}/.test(kanban), 'o card mostra o nome do cliente em destaque')
ok(/linkTelefone\(c\.cliente_telefone\)/.test(kanban), 'o card mostra o telefone do cliente para ligar')

const dir = 'supabase/migrations'
const defs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /FUNCTION\s+public\.fn_crm_pipeline\s*\(/i.test(readFileSync(`${dir}/${f}`, 'utf8')))
const vigente = defs[defs.length - 1]
const sql = readFileSync(`${dir}/${vigente}`, 'utf8')
ok(vigente === '20260930150000_crm_pipeline_cliente_telefone.sql', `definição vigente de fn_crm_pipeline (${vigente})`)
ok(/'cliente_telefone'/.test(sql), 'fn_crm_pipeline devolve o telefone do cliente')
ok(/NOT IN \(SELECT public\.get_user_company_ids\(\)\)/.test(sql) && /ERRCODE = '42501'/.test(sql), 'fn_crm_pipeline confere se a empresa é do usuário')
ok(/REVOKE ALL ON FUNCTION public\.fn_crm_pipeline\(uuid\) FROM PUBLIC, anon/.test(sql), 'sem acesso anônimo')

if (falhas > 0) { console.error(`\n[check-oportunidade-cliente] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-oportunidade-cliente] oportunidade com cliente e telefone conferida.')
