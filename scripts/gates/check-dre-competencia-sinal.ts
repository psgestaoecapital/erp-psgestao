// Gate (CEO 07/10, DRE núcleo): a migration 20261007170000 mantém (1) competência = COALESCE(data_competencia, data_emissao)
// nos blocos de pagar/receber DIRETO e no receber do ramo Omie, (2) receita em NAO_OPER gravada com sinal negativo
// (o leitor subtrai o grupo), (3) trigger que marca emissão, competência e pagamento, no estado novo e no antigo. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261007170000_dre_competencia_sinal_mes_sujo.sql', 'utf8')
const fn = sql.slice(sql.indexOf('fn_psgc_recalcular_dre_mes'), sql.indexOf('trg_psgc_enfileirar_lancamento()'))
const trg = sql.slice(sql.indexOf('trg_psgc_enfileirar_lancamento()'))

// Teste 1 — competência: nenhum filtro de mês do bloco competência lê data_emissao crua em pagar/receber
ok((fn.match(/COALESCE\((p|r)?\.?data_competencia, (p|r)?\.?data_emissao\)/g) ?? []).length >= 8, 'competência usa COALESCE(data_competencia, data_emissao) em pagar e receber (flags + blocos)')
ok(!/p\.data_emissao BETWEEN/.test(fn) && !/r\.data_emissao::date BETWEEN/.test(fn), 'sem filtro de mês por data_emissao crua em erp_pagar/erp_receber')
ok(/data_pagamento BETWEEN v_data_inicio/.test(fn), 'regime caixa continua por data_pagamento')
ok(/DELETE FROM psgc_dre WHERE company_id = p_company_id AND ano = p_ano AND mes = p_mes;/.test(fn), 'mês limpo antes de somar (ON CONFLICT soma não duplica)')
// Teste 2 — sinal e mês sujo
ok((fn.match(/dre_grupo = 'NAO_OPER' THEN -/g) ?? []).length === 3, 'receita em NAO_OPER sai negativa nos 3 blocos de receber (competência Omie, competência direto, caixa)')
ok(/data_competencia/.test(trg) && /data_pagamento/.test(trg) && /to_jsonb\(OLD\)/.test(trg), 'trigger marca competência e pagamento, também do estado antigo')
ok(/'data_competencia'/.test(trg.slice(0, trg.indexOf('BEGIN'))), 'mudar só a data_competencia já enfileira')

if (falhas) { console.error(`\ncheck-dre-competencia-sinal: ${falhas} falha(s)`); process.exit(1) }
console.log('\nDRE · competência, sinal e mês sujo: ok')
