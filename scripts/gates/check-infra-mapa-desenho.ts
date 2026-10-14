// Gate · Mapa da Infra fatia 1: tabelas novas com RLS só equipe PS, REVOKE anon, batimento só service_role.
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261014233005_dev_infra_mapa_desenho.sql', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada')
exige(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/.test(sql), 'REVOKE anon nas tabelas')
exige(/fn_dev_painel_pode_ver\(\)/.test(sql), 'policy da equipe PS')
exige(/REVOKE ALL ON FUNCTION public\.fn_infra_batimento_registrar\([^)]*\) FROM PUBLIC, anon, authenticated/.test(sql), 'batimento só serviço')
exige(/REVOKE ALL ON FUNCTION public\.fn_infra_estado\(\) FROM PUBLIC, anon/.test(sql), 'estado sem anon')
exige(!/\b(UPDATE|DROP|TRUNCATE)\b/i.test(sql.replace(/DROP POLICY IF EXISTS/g, '')), 'migration aditiva')
for (const t of ['erp_infra_no', 'erp_infra_ligacao', 'erp_infra_batimento']) exige(sql.includes(t), `tabela ${t}`)
if (falhas.length) { console.error('check-infra-mapa-desenho FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-infra-mapa-desenho ok')
