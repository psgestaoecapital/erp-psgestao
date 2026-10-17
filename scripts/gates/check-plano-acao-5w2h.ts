/**
 * Gate de build (CEO 06/10): Plano de Ação 5W2H.
 *   1) migration aditiva: 3 tabelas erp_pa_* com RLS ligada, policy por empresa e REVOKE de anon;
 *   2) só o dono (responsável/criador) altera a ação; histórico só aceita comentário do próprio autor;
 *   3) regras puras: atrasada calculada, pauta = pendências, vencendo em 2 dias;
 *   4) tela compartilhada com as 4 visões e ata.
 *   npm run gates -- plano-acao-5w2h
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atrasada, pendente, vencendo, diasParaPrazo } from '../../src/lib/planoAcao/regras'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync(join(__dirname, '../../supabase/migrations/20261007060005_plano_acao_5w2h.sql'), 'utf8').replace(/--[^\n]*/g, '')
for (const t of ['erp_pa_rotina', 'erp_pa_acao', 'erp_pa_historico']) {
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql), `${t}: RLS ligada`)
  ok(new RegExp(`CREATE POLICY \\w+ ON public\\.${t} FOR SELECT[\\s\\S]*?user_company_ids`).test(sql), `${t}: leitura por empresa`)
}
ok(/REVOKE ALL ON public\.erp_pa_rotina, public\.erp_pa_acao, public\.erp_pa_historico FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
ok(/pa_acao_upd[\s\S]*?quem_id = auth\.uid\(\) OR criado_por = auth\.uid\(\)/.test(sql), 'só o dono altera a ação')
ok(/pa_hist_ins[\s\S]*?tipo = 'comentario' AND autor_id = auth\.uid\(\)/.test(sql), 'histórico: só comentário do próprio autor')
ok(!/DROP TABLE|DELETE FROM|TRUNCATE|CREATE TABLE (IF NOT EXISTS )?public\.plano_acao\b/i.test(sql), 'aditiva e sem recriar a antiga plano_acao (RD-26)')
ok(!/GRANT[^;]*\banon\b/.test(sql), 'sem GRANT a anon')

const hoje = '2026-10-07'
ok(atrasada({ status: 'aberta', quando: '2026-10-06' }, hoje), 'prazo vencido e aberta = atrasada')
ok(!atrasada({ status: 'concluida', quando: '2026-10-01' }, hoje), 'concluída nunca é atrasada')
ok(!atrasada({ status: 'aberta', quando: null }, hoje), 'sem prazo não é atrasada')
ok(!atrasada({ status: 'aberta', quando: hoje }, hoje), 'prazo hoje ainda não é atrasada')
ok(pendente({ status: 'em_andamento', quando: null }) && !pendente({ status: 'cancelada', quando: null }), 'pauta só com aberta/em andamento')
ok(vencendo({ status: 'aberta', quando: '2026-10-09' }, hoje) && !vencendo({ status: 'aberta', quando: '2026-10-10' }, hoje), 'vencendo = até 2 dias')
ok(diasParaPrazo({ status: 'aberta', quando: '2026-10-08' }, hoje) === 1, 'dias para o prazo')

const tela = readFileSync(join(__dirname, '../../src/app/dashboard/_compartilhado/plano-acao/page.tsx'), 'utf8')
ok(/Por reunião/.test(tela) && /Minhas ações/.test(tela) && /Atrasadas/.test(tela) && /Kanban/.test(tela), 'tela: 4 visões')
ok(/\.print\(\)/.test(tela) && /Ata/.test(tela), 'tela: ata para PDF')
for (const c of ['O quê', 'Por quê', 'Onde', 'Quando', 'Quem', 'Como', 'Quanto'])
  ok(tela.includes(`aria-label="${c}"`), `tela: campo ${c}`)

if (falhas) { console.error(`\n[check-plano-acao-5w2h] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-plano-acao-5w2h] Plano de Ação 5W2H conferido.')
