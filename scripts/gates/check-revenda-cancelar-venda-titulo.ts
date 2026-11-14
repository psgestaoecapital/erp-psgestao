// Gate (chamado #6928): cancelar venda com título aberto no financeiro (GE) PERGUNTA antes (Sim/Não/Voltar), nunca cancela
// sozinho, nunca cancela título pago, reaproveita fn_receber_cancelar (sem função nova) e avisa no card. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/revenda/vendas/page.tsx', 'utf8')
const cancelar = src.slice(src.indexOf('async function cancelar('), src.indexOf('async function executarCancelar('))
const exec = src.slice(src.indexOf('async function executarCancelar('), src.indexOf("if (!companyId) return <div"))
ok(cancelar.includes('setCancelaTit(') && cancelar.includes('abertos.length > 0'), 'com título aberto, abre a pergunta (não cancela direto)')
ok(src.includes("const ABERTO = ['aberto', 'vencido', 'pendente']"), 'só título aberto/vencido/pendente é candidato (pago/cancelado ficam fora)')
ok(exec.includes("rpc('fn_receber_cancelar'"), 'reaproveita fn_receber_cancelar do financeiro')
ok(exec.indexOf("rpc('fn_veic_venda_cancelar'") < exec.indexOf("rpc('fn_receber_cancelar'"), 'título só é cancelado depois da venda cancelada')
ok(src.includes('Sim, cancelar venda e título') && src.includes('Não, só a venda') && src.includes('>Voltar<'), 'pergunta tem Sim, Não e Voltar')
ok(src.includes('Venda cancelada, mas o título do financeiro continua em aberto'), 'card da venda cancelada avisa título em aberto')

if (falhas) process.exit(1)
