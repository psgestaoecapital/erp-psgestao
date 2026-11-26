// Gate (chamado #6928 · #6254): cancelar venda com título a receber EM ABERTO no financeiro (GE)
// PERGUNTA antes (Sim/Não/Voltar), nunca cancela sozinho, nunca cancela título PAGO, reaproveita
// fn_receber_cancelar (sem função nova), cancela o título SÓ DEPOIS da venda e avisa no card. Sem rede.
//
// AJUSTES Eng. Chefe (#6254): a venda e os títulos são tratados numa ÚNICA transação no BACKEND
// (fn_veic_venda_cancelar com p_titulos 'cancelar'|'manter'), não mais num laço de RPC no cliente.
// Este gate prova a REGRA onde ela passou a viver (a função da migration) + a pergunta na tela —
// sem afrouxar: a ordem (título depois da venda), o reuso de fn_receber_cancelar e o nunca-tocar-pago
// continuam exigidos.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// --- Tela: a pergunta e a delegação ao backend ---------------------------------------------------
const src = readFileSync('src/app/dashboard/revenda/vendas/page.tsx', 'utf8')
const cancelar = src.slice(src.indexOf('async function cancelar('), src.indexOf('async function executarCancelar('))
const exec = src.slice(src.indexOf('async function executarCancelar('), src.indexOf("if (!companyId) return <div"))

ok(cancelar.includes('setCancelaTit(') && cancelar.includes('abertos.length > 0'), 'com título aberto, abre a pergunta (não cancela direto)')
ok(src.includes("const ABERTO = ['aberto', 'vencido', 'pendente']"), 'só título aberto/vencido/pendente é candidato (pago/cancelado ficam fora)')
ok(src.includes('Sim, cancelar venda e título') && src.includes('Não, só a venda') && src.includes('>Voltar<'), 'pergunta tem Sim, Não e Voltar')
ok(src.includes('Venda cancelada, mas o título do financeiro continua em aberto'), 'card da venda cancelada avisa título em aberto')
// A tela delega ao backend numa única transação (p_titulos) e NÃO cancela o título no cliente.
ok(exec.includes("rpc('fn_veic_venda_cancelar'") && exec.includes('p_titulos'), 'a tela delega ao backend em uma transação (fn_veic_venda_cancelar com p_titulos)')
ok(!exec.includes("rpc('fn_receber_cancelar'"), 'a tela não cancela o título por fora (sem laço de fn_receber_cancelar no cliente)')

// --- Backend: a REGRA na função da migration -----------------------------------------------------
const migDir = 'supabase/migrations'
const migFile = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .reverse()
  .find((f) => {
    const t = readFileSync(`${migDir}/${f}`, 'utf8')
    return /FUNCTION\s+public\.fn_veic_venda_cancelar/.test(t) && t.includes('p_titulos')
  })
ok(!!migFile, 'existe a migration que define fn_veic_venda_cancelar com p_titulos')

const mig = migFile ? readFileSync(`${migDir}/${migFile}`, 'utf8') : ''
const iUpdate = mig.indexOf("SET situacao = 'cancelada'")      // cancela a VENDA
const iPerform = mig.indexOf('PERFORM fn_receber_cancelar(')    // cancela o TÍTULO (reuso)

ok(iPerform > -1, 'reaproveita fn_receber_cancelar do financeiro (sem função nova)')
ok(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION[^;]*fn_receber/i.test(mig), 'não cria nenhuma função fn_receber_* nova')
ok(iUpdate > -1 && iPerform > -1 && iUpdate < iPerform, 'título só é cancelado DEPOIS da venda cancelada')
ok(mig.includes("r.status IN ('aberto','parcial','vencido','previsto')"), 'o laço só pega título em aberto (nunca o pago/recebido)')
ok(mig.includes("v_escolha = 'cancelar'") && mig.includes('n_abertos > 0'), "só cancela o título quando a escolha é 'cancelar' e há título aberto")

if (falhas) process.exit(1)
console.log('check-revenda-cancelar-venda-titulo: ok')
