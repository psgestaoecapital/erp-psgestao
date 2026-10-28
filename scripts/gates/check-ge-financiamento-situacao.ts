// Gate · GE › Financiamento (pedido Tryo Gesso via CEO, 28/10/2026): editar, arquivar, quitar, excluir COM RASTRO e
// restaurar; filtro de vencidos. Sem rede. Confere:
//  1) a tela não apaga contrato de vez (nenhum .delete() em financiamentos) e usa fn_financiamento_situacao;
//  2) a tela tem os filtros (andamento/vencidos/quitados/arquivados/excluídos), "Arquivar os vencidos" e "Restaurar";
//  3) a migration: colunas de rastro, motivo obrigatório na exclusão, guarda de empresa, autoria por auth.uid(),
//     nada aberto a anônimo, nada apagado, nenhuma função existente recriada.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const tela = readFileSync('src/app/dashboard/gestao-empresarial/financiamento/page.tsx', 'utf8')
ok(!/from\('financiamentos'\)[\s\S]{0,40}\.delete\(\)/.test(tela), 'tela não apaga contrato de vez')
ok(/rpc\('fn_financiamento_situacao'/.test(tela), 'ações pela fn_financiamento_situacao')
for (const f of ['andamento', 'vencidos', 'quitados', 'arquivados', 'excluidos']) ok(tela.includes(`k: '${f}'`), `filtro ${f}`)
ok(/fin-arquivar-vencidos/.test(tela) && /fin-restaurar/.test(tela) && /fin-desarquivar/.test(tela), 'arquivar vencidos em lote, desarquivar e restaurar')
ok(/AjudaCampo chave="ge\.financiamento\.filtro"/.test(tela) && /ge\.financiamento\.acoes/.test(tela), '"?" nos filtros e nas ações (RD-95)')

const mig = readFileSync('supabase/migrations/20261030140000_ge_financiamento_arquivar_excluir.sql', 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
for (const c of ['arquivado_em', 'arquivado_por', 'excluido_em', 'excluido_por', 'excluido_motivo', 'quitado_em', 'status_anterior']) {
  ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(sql), `coluna ${c}`)
}
ok(/IF v_motivo IS NULL THEN RETURN jsonb_build_object\('ok', false, 'erro', 'motivo_obrigatorio'\)/.test(sql), 'exclusão exige motivo')
ok(/f\.company_id IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)/.test(sql), 'guarda de empresa')
ok(/v_uid uuid := auth\.uid\(\)/.test(sql) && /excluido_por = v_uid/.test(sql), 'autoria por auth.uid()')
ok(/REVOKE ALL ON FUNCTION public\.fn_financiamento_situacao\(uuid, text, text, date\) FROM PUBLIC, anon/.test(sql), 'nada aberto a anônimo')
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b/i.test(sql), 'nada apagado')
const recriadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1])
ok(recriadas.length === 1 && recriadas[0] === 'fn_financiamento_situacao', 'só a função nova')

if (falhas) { console.error(`\n${falhas} falha(s) — GE financiamento`); process.exit(1) }
console.log('\nGE financiamento ok')
