// Gate (RD-98, auditor em /dashboard/projetos/simulador) — o simulador abre já com uma montagem (resultado real, sem
// clicar), salva/lista simulações e exclui com soft-delete rastreável (sem DELETE físico, sem escrita direta na tabela).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/app/dashboard/projetos/simulador/page.tsx', 'utf8')
ok(tela.includes('setMontagemId((atual) => atual ||'), 'abre com a primeira montagem escolhida (resultado sem clicar)')
for (const id of ['simulador-nome', 'simulador-salvar', 'simulador-salvas', 'simulador-salva', 'simulador-excluir', 'simulador-excluir-modal', 'simulador-excluir-confirmar']) {
  ok(tela.includes(`data-testid="${id}"`), `tela tem data-testid ${id}`)
}
ok(tela.includes('rpc("fn_simulador_salvar"') && tela.includes('rpc("fn_simulador_excluir"'), 'salva/exclui por RPC')
ok(!/erp_hub_simulacao"\)\s*\.(insert|update|delete|upsert)\(/.test(tela), 'tela nunca escreve direto na tabela')
ok(tela.includes('.is("excluido_em", null)'), 'lista filtra excluido_em')

const mig = readdirSync('supabase/migrations').find((f) => f.includes('hub_simulador_rd98_simulacoes_salvas'))
ok(!!mig, 'migration existe')
if (mig) {
  const sql = readFileSync(`supabase/migrations/${mig}`, 'utf8')
  ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids/.test(sql), 'RLS ligada, policy por empresa')
  ok(!/USING\s*\(\s*true\s*\)/i.test(sql), 'nenhuma policy permissiva (qual=true)')
  ok(/REVOKE ALL ON public\.erp_hub_simulacao FROM PUBLIC, anon/.test(sql) && /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.erp_hub_simulacao FROM authenticated/.test(sql), 'REVOKE anon + escrita só pelas RPCs')
  ok(!/DELETE\s+FROM\s+public\.erp_hub_simulacao/i.test(sql), 'nenhum DELETE físico')
  ok((sql.match(/fn__guarda_empresa/g) ?? []).length >= 2 && (sql.match(/audit_log_global/g) ?? []).length >= 2, 'RPCs com guarda de empresa e audit_log')
  ok(/fn_simular_montagem\(p_servico_id, p_company_id/.test(sql), 'valor salvo é recalculado no servidor')
  for (const k of ['quantitativo', 'nome_simulacao', 'salvar', 'salvas', 'excluir', 'motivo_exclusao']) {
    ok(sql.includes(`'projetos.simulador.${k}'`) && tela.includes(`projetos.simulador.${k}`), `"?" projetos.simulador.${k} no banco e na tela`)
  }
}
if (falhas) { console.error(`\ncheck-hub-simulador-salvas: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-hub-simulador-salvas: verde')
