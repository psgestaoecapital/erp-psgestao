/**
 * Gate de build · #2751 etapa 3 (Jordana · Gean): na composição do saldo, cada conta com leitura de extrato mostra o
 * saldo do último extrato e a diferença sistema − extrato, com o "?" (RD-95) cadastrado por migration.
 * Regra em src/lib/financeiro/saldoContaExtrato.ts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { compararContaExtrato } from '../../src/lib/financeiro/saldoContaExtrato'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

ok(compararContaExtrato(100, null) === null, 'conta sem leitura de extrato → sem linha')
ok(compararContaExtrato(100, undefined) === null, 'saldo_extrato ausente → sem linha')
const g = compararContaExtrato(18902.62, 46404.67)
ok(!!g && g.diferenca === -27502.05 && !g.bate, 'caso Gean SICREDI: sistema 18.902,62 × extrato 46.404,67 → −27.502,05')
const b = compararContaExtrato(1000.004, 1000)
ok(!!b && b.bate && b.extrato === 1000, 'diferença abaixo de 1 centavo → bate')
const z = compararContaExtrato(null, 250)
ok(!!z && z.diferenca === -250, 'saldo do sistema nulo conta como zero')

const tela = readFileSync('src/components/ge/HeroSaldoBancario.tsx', 'utf8')
ok(tela.includes('compararContaExtrato(a.saldo, a.saldo_extrato)'), 'a composição usa a regra única por conta')
ok(tela.includes('data-testid="saldo-composicao-extrato"'), 'linha do último extrato tem data-testid')
ok(/<AjudaCampo chave="ge\.saldo\.conta_extrato"/.test(tela), 'indicador novo tem o "?" (RD-95)')

const mig = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
  .some((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').includes("'ge.saldo.conta_extrato'"))
ok(mig, 'chave ge.saldo.conta_extrato cadastrada em erp_ajuda_campo por migration')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do último extrato por conta (#2751)`); process.exit(1) }
console.log('✓ #2751 etapa 3: último extrato por conta com diferença e "?"')
