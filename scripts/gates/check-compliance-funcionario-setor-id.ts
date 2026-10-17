/**
 * Gate de build · Chamado #42 (Frioeste): funcionário com setor só em texto não recebia a exigência do setor.
 *   tsx scripts/gates/check-compliance-funcionario-setor-id.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const mig = readFileSync('supabase/migrations/20261017080010_compliance_funcionario_setor_id_vinculo.sql', 'utf8')
ok(/UPDATE public\.compliance_funcionarios f[\s\S]*WHERE f\.setor_id IS NULL/.test(mig), 'preenchimento só onde setor_id é NULL (nada já vinculado muda)')
ok(/s\.company_id = p_company_id/.test(mig), 'o setor casado é sempre da MESMA empresa')
ok(!/DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i.test(mig), 'nada é apagado (RD-55)')
ok(/BEFORE INSERT OR UPDATE OF setor, setor_id ON public\.compliance_funcionarios/.test(mig), 'gatilho mantém o vínculo em cadastros novos')
ok(/REVOKE ALL ON FUNCTION public\.fn_compliance_setor_id_por_nome/.test(mig), 'função auxiliar sem acesso anon')
ok(/compliance_funcionarios_setor_backfill_20261015[\s\S]*ENABLE ROW LEVEL SECURITY[\s\S]*REVOKE ALL ON public\.compliance_funcionarios_setor_backfill_20261015[\s\S]*INSERT INTO public\.compliance_funcionarios_setor_backfill_20261015[\s\S]*UPDATE public\.compliance_funcionarios f/.test(mig), 'rastro com RLS/REVOKE gravado ANTES do UPDATE (reversível)')

if (falhas > 0) { console.error(`\n[check-compliance-funcionario-setor-id] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-compliance-funcionario-setor-id] vínculo funcionário → setor conferido.')
