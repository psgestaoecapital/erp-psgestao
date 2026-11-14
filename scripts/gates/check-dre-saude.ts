// Gate (CEO 28/10 · detalhe × DRE, Parte 3): "Saúde do DRE". A fn_psgc_dre_conciliacao reconcilia TODAS as contas
// numa chamada (soma do detalhe COM SINAL × linha do DRE COM SINAL, mesma aritmética da Parte 1), é SÓ DE LEITURA,
// com guarda de empresa e REVOKE anon; a tela DREHorizontal consome e mostra o indicador + ⚠ na conta que não bate.
// Estático, sem rede. Também roda o modelo do sinal com entradas fixas e prova que a soma por conta fecha com a linha.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_dre_conciliacao_saude.sql'))
ok(!!arq, 'migration existe')
const sql = arq ? readFileSync('supabase/migrations/' + arq, 'utf8') : ''

ok(/CREATE OR REPLACE FUNCTION public\.fn_psgc_dre_conciliacao\(/.test(sql), 'função fn_psgc_dre_conciliacao criada')
ok(/STABLE SECURITY DEFINER/.test(sql), 'função STABLE SECURITY DEFINER')
// corpo da FUNÇÃO (do CREATE até o REVOKE) — o INSERT de ajuda (erp_ajuda_campo) é seed de referência, fora do corpo.
const corpoIni = sql.indexOf('CREATE OR REPLACE FUNCTION')
const corpoFim = sql.indexOf('REVOKE ALL ON FUNCTION')
const corpo = corpoIni >= 0 && corpoFim > corpoIni ? sql.slice(corpoIni, corpoFim) : sql
ok(!/\b(INSERT|UPDATE|DELETE)\b\s+(INTO\s+)?(public\.)?(erp_|psgc_)/i.test(corpo), 'corpo da função só de leitura (não grava em erp_/psgc_)')
ok(/get_user_company_ids\(\)/.test(sql) && /is_admin\(\)/.test(sql), 'guarda de empresa (is_admin + get_user_company_ids)')
ok(/REVOKE ALL ON FUNCTION public\.fn_psgc_dre_conciliacao\(uuid\[\], date, date, text\) FROM PUBLIC, anon/.test(sql)
  && /GRANT EXECUTE ON FUNCTION public\.fn_psgc_dre_conciliacao\(uuid\[\], date, date, text\) TO authenticated/.test(sql),
  'REVOKE anon/PUBLIC, GRANT só authenticated/service_role')
ok(/FROM erp_pagar p/.test(sql) && /FROM erp_receber r/.test(sql) && /UNION ALL/.test(sql), 'lê erp_pagar E erp_receber (dois lados)')
ok(/d\.source ILIKE '%receber%' AND pc\.dre_grupo IN \('NAO_OPER','RESULT_FIN'\) THEN -d\.valor ELSE d\.valor/.test(sql),
  'dre_periodo com sinal (mesma aritmética da Parte 1 / horizontal)')
ok(/'n_conciliam'/.test(sql) && /'n_diferem'/.test(sql) && /'concilia'/.test(sql), 'resumo traz n_conciliam / n_diferem e o flag concilia por conta')
ok(/financeiro\.dre_consolidado\.saude_dre/.test(sql) && /erp_ajuda_campo/.test(sql), 'RD-95: chave de ajuda do indicador (saude_dre) na migration')

const tela = readFileSync('src/components/financeiro/DREHorizontal.tsx', 'utf8')
ok(/fn_psgc_dre_conciliacao/.test(tela), 'DREHorizontal consome fn_psgc_dre_conciliacao')
ok(/Saúde do DRE/.test(tela), 'tela mostra o indicador "Saúde do DRE"')
ok(/concDiferem\.has\(l\.codigo\)/.test(tela), 'tela marca ⚠ na conta cujo detalhe não bate')
ok(/chave="financeiro\.dre_consolidado\.saude_dre"/.test(tela), 'RD-95: "?" no indicador Saúde do DRE')

// modelo do sinal (entradas fixas): a soma do detalhe por conta tem de fechar com a linha do DRE
type T = { origem: 'a pagar' | 'a receber'; valor: number }
const signo = (g: string) => (['ROB', 'RECEITAS_NAO_OP'].includes(g) ? 1 : -1)
const exibido = (g: string, t: T) => t.origem === 'a pagar'
  ? signo(g) * t.valor
  : signo(g) * (['NAO_OPER', 'RESULT_FIN'].includes(g) ? -1 : 1) * t.valor
const dre = (g: string, t: T[]) => signo(g) * t.reduce((s, x) => s + (x.origem === 'a receber' && ['NAO_OPER', 'RESULT_FIN'].includes(g) ? -x.valor : x.valor), 0)
const casos: [string, T[]][] = [
  ['RESULT_FIN', [{ origem: 'a receber', valor: 1000 }, { origem: 'a pagar', valor: 310.5 }]],
  ['NAO_OPER', [{ origem: 'a receber', valor: 80 }, { origem: 'a pagar', valor: 220 }]],
  ['ROB', [{ origem: 'a receber', valor: 5000 }]],
  ['CMV', [{ origem: 'a pagar', valor: 77459.28 }]],
]
for (const [g, ts] of casos) {
  const soma = Math.round(ts.reduce((s, t) => s + exibido(g, t), 0) * 100) / 100
  ok(Math.round((soma - dre(g, ts)) * 100) === 0, `${g}: soma do detalhe por conta (${soma}) = linha do DRE (diferença 0)`)
}

if (falhas) { console.error(`\n${falhas} falha(s) no gate Saúde do DRE`); process.exit(1) }
console.log('\nSaúde do DRE (conciliação por conta): ok')
