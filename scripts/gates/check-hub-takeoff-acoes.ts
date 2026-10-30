// Gate (RD-98, auditor em /dashboard/projetos/takeoff) — cada planta enviada tem ações (ver orçamento, re-analisar, editar,
// excluir), a exclusão é soft-delete rastreável (sem DELETE físico), a lista e o acervo filtram deleted_at e cada planta
// mostra a etapa X de 6. Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { progressoPlanta } from '../../src/lib/hub/takeoff'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const pdf = { status: 'processada', arquivo_tipo: 'pdf', aps_status: null, orcamento_id: null as string | null }
const prog1 = progressoPlanta({ ...pdf, status: 'enviada' }, [])
ok(prog1.atual === 2 && prog1.total === 6 && prog1.rotulo === 'Analisar', 'planta só enviada → "Etapa 2 de 6: Analisar"')
const amb = [{ confirmado: false, servico_id: null }]
ok(progressoPlanta(pdf, amb).atual === 3, 'ambiente sem confirmar → etapa 3 (revisar medidas)')
const tudo = [{ confirmado: true, servico_id: 's' }]
ok(progressoPlanta(pdf, tudo).atual === 5, 'pronta sem orçamento de destino → etapa 5')
ok(progressoPlanta({ ...pdf, orcamento_id: 'o1' }, tudo).atual === 6, 'com destino, falta gerar → etapa 6')
ok(progressoPlanta({ ...pdf, status: 'confirmada' }, tudo).concluido, 'planta confirmada → concluído')

const tela = readFileSync('src/app/dashboard/projetos/takeoff/page.tsx', 'utf8')
for (const id of ['takeoff-planta-acoes', 'takeoff-acao-ver-orcamento', 'takeoff-acao-reanalisar', 'takeoff-acao-editar', 'takeoff-acao-excluir', 'takeoff-planta-progresso', 'takeoff-excluir-modal', 'takeoff-editar-modal', 'takeoff-destino-aviso']) {
  ok(tela.includes(`data-testid="${id}"`), `tela tem data-testid ${id}`)
}
ok(tela.includes("rpc('fn_takeoff_planta_excluir'") && tela.includes("rpc('fn_takeoff_planta_editar'"), 'tela exclui/edita por RPC (sem DELETE direto)')
ok(!/from\('erp_obra_planta'\)\s*\.delete\(/.test(tela), 'tela nunca faz DELETE físico em erp_obra_planta')
ok(tela.includes(".is('deleted_at', null)"), 'lista de plantas filtra deleted_at')
ok(readFileSync('src/app/dashboard/projetos/takeoff/acervo/page.tsx', 'utf8').includes(".is('deleted_at', null)"), 'acervo filtra deleted_at')
ok(readFileSync('src/app/dashboard/projetos/engenharia/page.tsx', 'utf8').includes(".is('deleted_at', null)"), 'engenharia filtra deleted_at nas plantas')

const mig = readdirSync('supabase/migrations').filter((f) => f.includes('hub_takeoff_rd98_acoes_planta_softdelete'))
ok(mig.length === 1, 'migration das ações da planta existe')
if (mig[0]) {
  const sql = readFileSync(`supabase/migrations/${mig[0]}`, 'utf8')
  ok(/ADD COLUMN IF NOT EXISTS deleted_at/.test(sql) && /deleted_by/.test(sql) && /motivo_exclusao/.test(sql), 'migration: deleted_at + deleted_by + motivo_exclusao')
  ok(/audit_log_global/.test(sql), 'migration: exclusão grava audit_log_global')
  ok(!/DELETE\s+FROM\s+public\.erp_obra_planta/i.test(sql), 'migration: nenhum DELETE físico da planta')
  ok(/fn__guarda_empresa/.test(sql), 'migration: RPCs com guarda de empresa')
  ok(/REVOKE ALL ON FUNCTION public\.fn_takeoff_planta_excluir/.test(sql) && /REVOKE ALL ON FUNCTION public\.fn_takeoff_planta_editar/.test(sql), 'migration: REVOKE anon nas RPCs')
  ok(/deleted_at IS NULL/.test(sql.split('procurar_por_hash')[1] ?? ''), 'migration: busca por hash ignora planta excluída')
  for (const k of ['acoes', 'planta_progresso', 'planta_editar', 'planta_excluir', 'motivo_exclusao', 'planta_nome']) {
    ok(sql.includes(`'projetos.takeoff.${k}'`) && tela.includes(`projetos.takeoff.${k}`), `"?" projetos.takeoff.${k} no banco e na tela`)
  }
}
if (falhas) { console.error(`\ncheck-hub-takeoff-acoes: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-hub-takeoff-acoes: verde')
