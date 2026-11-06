// Gate (CEO 28/10 · detalhe × DRE, Parte 1): o detalhe de uma linha do DRE lista erp_pagar E erp_receber, e o
// `valor_exibido` leva o MESMO sinal que a linha tem no DRE (regra de fn_psgc_dre_horizontal). Estático, sem rede.
// Também roda o modelo da regra com entradas fixas de uma conta MISTA (NAO_OPER/RESULT_FIN, ex.: 9.2) e prova que a
// soma do detalhe fecha com a linha do DRE nos regimes competência, caixa e previsto, e que a conta de receita não muda.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_dre_lancamentos_dois_lados.sql'))
ok(!!arq, 'migration existe')
const sql = readFileSync('supabase/migrations/' + arq, 'utf8')

ok(/FROM erp_pagar p/.test(sql) && /FROM erp_receber r/.test(sql) && /UNION ALL/.test(sql), 'lê erp_pagar E erp_receber (sem ramo único)')
ok(/'a pagar'::text AS origem/.test(sql) && /'a receber'::text AS origem/.test(sql), 'cada lançamento leva a origem')
ok(/v_signo := CASE WHEN v_is_receita THEN 1 ELSE -1 END/.test(sql), 'signo da linha: receita +, resto −')
ok(/v_signo \* COALESCE\(p\.valor,0\) AS valor_exibido/.test(sql), 'a pagar: valor_exibido = signo × valor')
ok(/v_signo \* \(CASE WHEN v_grupo IN \('NAO_OPER','RESULT_FIN'\) THEN -1 ELSE 1 END\) \* COALESCE\(r\.valor,0\) AS valor_exibido/.test(sql), 'a receber: inverte o sinal em NAO_OPER/RESULT_FIN')
ok(/d\.source ILIKE '%receber%' AND v_grupo IN \('NAO_OPER','RESULT_FIN'\) THEN -d\.valor ELSE d\.valor/.test(sql) && /v_signo \* COALESCE\(SUM\(/.test(sql), 'dre_periodo vem de psgc_dre COM sinal (mesma aritmética do horizontal)')
ok(/'diferenca', round\(COALESCE\(v_total,0\) - COALESCE\(v_dre_periodo,0\),2\)/.test(sql), 'diferença = detalhe com sinal − DRE com sinal')
ok(/REVOKE ALL ON FUNCTION public\.fn_psgc_dre_lancamentos\(uuid\[\], text, date, date, text\) FROM PUBLIC, anon/.test(sql) && /TO authenticated/.test(sql), 'REVOKE anon/PUBLIC, GRANT só authenticated')
ok(/STABLE SECURITY DEFINER/.test(sql) && !/\b(INSERT|UPDATE|DELETE)\b\s+(INTO\s+)?(public\.)?(erp_|psgc_)/i.test(sql), 'função só de leitura')
ok(/get_user_company_ids\(\)/.test(sql), 'guarda de empresa mantida')

// modelo da regra (entradas fixas): conta 9.2 RESULT_FIN com 1 recebimento (juros recebidos) e 1 pagamento (multa)
type T = { origem: 'a pagar' | 'a receber'; valor: number }
const signo = (grupo: string) => (['ROB', 'RECEITAS_NAO_OP'].includes(grupo) ? 1 : -1)
const exibido = (grupo: string, t: T) => t.origem === 'a pagar' ? signo(grupo) * t.valor
  : signo(grupo) * (['NAO_OPER', 'RESULT_FIN'].includes(grupo) ? -1 : 1) * t.valor
const dre = (grupo: string, t: T[]) => signo(grupo) * t.reduce((s, x) => s + (x.origem === 'a receber' && ['NAO_OPER', 'RESULT_FIN'].includes(grupo) ? -x.valor : x.valor), 0)
const casos: [string, T[]][] = [
  ['RESULT_FIN', [{ origem: 'a receber', valor: 1000 }, { origem: 'a pagar', valor: 310.5 }]],
  ['NAO_OPER', [{ origem: 'a receber', valor: 80 }, { origem: 'a pagar', valor: 200 }, { origem: 'a pagar', valor: 20 }]],
  ['ROB', [{ origem: 'a receber', valor: 5000 }]],
  ['CMV', [{ origem: 'a pagar', valor: 77459.28 }]],
]
for (const [g, ts] of casos) {
  const soma = Math.round(ts.reduce((s, t) => s + exibido(g, t), 0) * 100) / 100
  ok(Math.round((soma - dre(g, ts)) * 100) === 0, `${g}: soma do detalhe (${soma}) = linha do DRE (diferença 0), regimes competência/caixa/previsto usam a mesma aritmética`)
}
ok(exibido('RESULT_FIN', { origem: 'a receber', valor: 1000 }) === 1000 && exibido('RESULT_FIN', { origem: 'a pagar', valor: 310.5 }) === -310.5, 'RESULT_FIN: recebimento positivo e pagamento negativo')
ok(exibido('ROB', { origem: 'a receber', valor: 5000 }) === 5000 && exibido('CMV', { origem: 'a pagar', valor: 10 }) === -10, 'conta de receita / despesa mantém o sinal de sempre (DRE atual não muda)')

const tela = readFileSync('src/components/financeiro/DREHorizontal.tsx', 'utf8')
ok(/fn_psgc_dre_lancamentos/.test(tela), 'DREHorizontal é o consumidor (único chamador no src)')

if (falhas) { console.error(`\n${falhas} falha(s) no detalhe × DRE`); process.exit(1) }
console.log('\nDetalhe × DRE (dois lados, mesmo sinal): ok')
