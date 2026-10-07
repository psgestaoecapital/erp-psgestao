/**
 * Gate de build (Eng. Chefe 07/10): DRE — competência, sinal da receita não-operacional e mês sujo.
 *   1) PAGAR/RECEBER DIRETO filtram por COALESCE(data_competencia, data_emissao), nunca só data_emissao;
 *   2) receita que cai em NAO_OPER/RESULT_FIN é gravada com o sinal do grupo (−1) nos 3 blocos de receber;
 *   3) o trigger de enfileiramento observa data_competencia e enfileira o mês da competência e o do pagamento;
 *   4) migration sem DROP/TRUNCATE.
 *   npm run gates -- dre-competencia
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const arq = '20261007180000_dre_competencia_sinal_mes_sujo.sql'
const s = readFileSync(join(__dirname, '../../supabase/migrations', arq), 'utf8').replace(/--[^\n]*/g, '')

ok(/p\.company_id = p_company_id AND COALESCE\(p\.data_competencia, p\.data_emissao\) IS NOT NULL\s+AND COALESCE\(p\.data_competencia, p\.data_emissao\) BETWEEN/.test(s), 'pagar direto usa a competência')
ok(/r\.company_id=p_company_id AND COALESCE\(r\.data_competencia, r\.data_emissao\) IS NOT NULL\s+AND COALESCE\(r\.data_competencia, r\.data_emissao\)::date BETWEEN/.test(s), 'receber direto usa a competência')
ok(/v_tem_pagar_emissao := EXISTS\(\s*SELECT 1 FROM erp_pagar\s+WHERE company_id=p_company_id AND COALESCE\(data_competencia, data_emissao\)/.test(s), 'flag v_tem_pagar_emissao usa a competência')
ok(/v_tem_receber_emissao := EXISTS\(\s*SELECT 1 FROM erp_receber\s+WHERE company_id=p_company_id AND COALESCE\(data_competencia, data_emissao\)/.test(s), 'flag v_tem_receber_emissao usa a competência')
ok(!/p\.data_emissao IS NOT NULL\s+AND p\.data_emissao BETWEEN/.test(s), 'pagar direto não filtra mais só por data_emissao')
ok((s.match(/CASE WHEN pcs\.dre_grupo IN \('NAO_OPER','RESULT_FIN'\) THEN -1 ELSE 1 END/g) ?? []).length === 3, 'sinal do grupo nos 3 blocos de receber (omie, direto, caixa)')
ok(/c_campos[\s\S]*'data_competencia'/.test(s), 'trigger observa data_competencia')
ok(/'data_competencia'\)::date, \(to_jsonb\(NEW\) ->> 'data_pagamento'\)::date/.test(s) && /to_jsonb\(OLD\) ->> 'data_competencia'/.test(s), 'trigger enfileira mês da competência e do pagamento (novo e antigo)')
ok(!/DROP |TRUNCATE/i.test(s), 'migration sem DROP/TRUNCATE')

if (falhas) { console.error(`\n[check-dre-competencia-sinal] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-dre-competencia-sinal] competência, sinal e mês sujo conferidos.')
