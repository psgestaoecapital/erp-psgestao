// Gate · DRE oficial por negócio usa as regras de rateio (CEO 06/11/2026). Sem rede. Confere:
//  1) aditivo: não reescreve o recálculo do DRE nem o motor de rateio; só refaz as 4 fontes pagar/receber direto/caixa;
//  2) trava de conferência: total por conta igual antes de trocar (senão mantém como estava);
//  3) opt-in: só age em empresa com regra por conta/texto ativa; genérico (nenhuma empresa fixa);
//  4) ganchos nunca derrubam a fila (EXCEPTION → WARNING); funções internas fora do alcance da tela;
//  5) mesma ordem de regras da tela Resultado por negócio (linha > centro > texto > conta mais específica).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_ge_dre_oficial_por_regras.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_ge_dre_oficial_por_regras.sql, achei ${arq.length}`); process.exit(1) }
const sql = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

ok(!/FUNCTION public\.fn_psgc_recalcular_dre_mes|FUNCTION public\.fn_rateio_calcular_mes|FUNCTION public\.fn_psgc_processar_fila/.test(sql), 'não reescreve recálculo, fila nem motor de rateio')
ok(/ARRAY\['etl_pagar_direto','etl_receber_direto','etl_pagar_caixa','etl_receber_caixa'\]/.test(sql), 'só as 4 fontes pagar/receber')
ok(/IF v_dif > 0\.05 THEN[\s\S]*?mantido como estava[\s\S]*?CONTINUE;/.test(sql), 'trava: total por conta igual, senão mantém')
const deletes = [...sql.matchAll(/DELETE FROM public\.psgc_dre[^;]*;/g)].map((m) => m[0])
ok(deletes.length === 1 && /d\.source = v_fonte/.test(deletes[0]) && /d\.mes = p_mes/.test(deletes[0]), 'só apaga a fonte e o mês conferidos')
ok((sql.match(/source_type IN \('conta','texto'\)\) THEN/g) || []).length >= 2, 'opt-in: só empresa com regra por conta/texto')
ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), 'nenhuma empresa fixa')
ok((sql.match(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/g) || []).length === 2, 'ganchos nunca derrubam a fila')
for (const f of ['fn_ge_dre_lancamentos_negocio(uuid, date, date)', 'fn_ge_dre_aplicar_regras_mes(uuid, integer, integer)', 'fn_ge_trg_dre_job_aplicar_regras()', 'fn_ge_trg_regra_enfileirar_dre()']) {
  ok(sql.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`), `interna fora da tela: ${f}`)
}
ok(/, 1 AS nivel, 0 AS len/.test(sql) && /, 2, 0\n/.test(sql) && /, 3, length\(g\.chave\)/.test(sql) && /, 4, length\(g\.chave\)/.test(sql) && /ORDER BY fonte, id, nivel, len DESC/.test(sql), 'ordem: linha > centro > texto > conta mais específica')
ok(/AFTER UPDATE OF status ON public\.psgc_job_queue[\s\S]*?NEW\.status = 'concluido'/.test(sql), 'gancho no fim do recálculo')

if (falhas) { console.error(`\n${falhas} falha(s) — DRE oficial por regras`); process.exit(1) }
console.log('\nDRE oficial por regras ok')
