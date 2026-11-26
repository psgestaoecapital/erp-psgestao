// Gate (chamado #6928): cancelar venda com título aberto no financeiro (GE) PERGUNTA antes (Sim/Não/Voltar), nunca cancela
// sozinho, nunca cancela título pago, reaproveita fn_receber_cancelar (sem função nova) e avisa no card. Sem rede.
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/revenda/vendas/page.tsx', 'utf8')
const cancelar = src.slice(src.indexOf('async function cancelar('), src.indexOf('async function executarCancelar('))
const exec = src.slice(src.indexOf('async function executarCancelar('), src.indexOf("if (!companyId) return <div"))
ok(cancelar.includes('setCancelaTit(') && cancelar.includes('abertos.length > 0'), 'com título aberto, abre a pergunta (não cancela direto)')
ok(src.includes("const ABERTO = ['aberto', 'vencido', 'pendente']"), 'só título aberto/vencido/pendente é candidato (pago/cancelado ficam fora)')
// Contrato novo (#6254 · conserto-main 26/11): a venda e os títulos em aberto são cancelados numa ÚNICA transação no
// banco (fn_veic_venda_cancelar com p_titulos 'cancelar'|'manter'), que reusa fn_receber_cancelar DEPOIS de cancelar a
// venda. A tela não faz mais o laço de RPC de títulos.
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const ultimaDef = migs.filter((f) => /FUNCTION\s+(public\.)?fn_veic_venda_cancelar\s*\(/i.test(readFileSync(`supabase/migrations/${f}`, 'utf8'))).pop()
const fnSql = ultimaDef ? readFileSync(`supabase/migrations/${ultimaDef}`, 'utf8') : ''
ok(exec.includes("rpc('fn_veic_venda_cancelar'") && /p_titulos:\s*cancelarTitulo\s*\?\s*'cancelar'\s*:\s*'manter'/.test(exec), 'tela passa a escolha (p_titulos cancelar/manter) numa só chamada')
ok(!exec.includes("rpc('fn_receber_cancelar'"), 'tela não cancela título por fora da transação')
ok(/PERFORM\s+(public\.)?fn_receber_cancelar\(/i.test(fnSql), 'reaproveita fn_receber_cancelar do financeiro (no banco)')
ok(fnSql.indexOf('fn_receber_cancelar(') > fnSql.search(/status\s*=\s*'cancelad/i), 'título só é cancelado depois da venda cancelada')
ok(src.includes('Sim, cancelar venda e título') && src.includes('Não, só a venda') && src.includes('>Voltar<'), 'pergunta tem Sim, Não e Voltar')
ok(src.includes('Venda cancelada, mas o título do financeiro continua em aberto'), 'card da venda cancelada avisa título em aberto')

if (falhas) process.exit(1)
