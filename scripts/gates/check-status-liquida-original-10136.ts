// Gate (#10136 · Jordana — casos reais Pdois/Proplay/Kgf): a regra de liquidação de título na trigger de status
// compartilhada (fn_trg_status_lancamento, usada por erp_receber e erp_pagar). Juros/multa de atraso NÃO podem
// manter o título 'parcial' depois que o valor ORIGINAL (líquido de desconto) foi pago. Roda no build, sem rede —
// lê a migration da correção.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const MIG = 'supabase/migrations/20261121130120_status_liquida_valor_original_10136.sql'
const mig = readFileSync(MIG, 'utf8')

ok(/CREATE OR REPLACE FUNCTION public\.fn_trg_status_lancamento\(\)/.test(mig), 'corrige a trigger de status compartilhada (receber + pagar)')
// valor original = valor - desconto (SEM juros/multa de atraso) é o limiar
ok(/v_original\s*:=\s*round\(COALESCE\(NEW\.valor,0\)\s*-\s*COALESCE\(NEW\.desconto,0\),\s*2\)/.test(mig),
   'limiar de liquidação é o valor original líquido de desconto (exclui juros/multa)')
// no ramo de pagamento > 0, liquida quando cobriu o original
ok(/round\(COALESCE\(NEW\.valor_pago,0\),\s*2\)\s*>=\s*v_original/.test(mig),
   'pagou >= valor original ⇒ liquida por inteiro (pago)')
// parcial permanece como alternativa quando pagou menos que o original
ok(/ELSE\s*\n\s*NEW\.status\s*:=\s*'parcial'/.test(mig), "parcial só quando pagou MENOS que o valor original")
// o ramo "saldo <= 0,01" continua existindo (sem regressão: cobriu tudo, inclusive juros, liquida como antes)
ok(/IF\s+v_saldo\s*<=\s*0\.01\s+THEN\s*\n\s*NEW\.status\s*:=\s*'pago'/.test(mig),
   'ramo saldo<=0,01 preservado (pagamento total continua liquidando)')
// aditiva: não altera dado existente (backfill é fatia separada com OK da Jordana)
ok(!/\b(UPDATE|DELETE|TRUNCATE)\s+public\.erp_(receber|pagar)\b/i.test(mig.replace(/--.*$/gm, '')),
   'não altera títulos já gravados (backfill é fatia separada)')

if (falhas) { console.error(`\n${falhas} falha(s) na regra de liquidação #10136`); process.exit(1) }
console.log('\nRegra de liquidação por valor original (#10136): ok')
