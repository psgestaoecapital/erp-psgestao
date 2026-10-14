// Gate · histórico da aba Codes: tabela com RLS só equipe PS, função só service_role, agendamento 15 min.
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261013210005_dev_codes_historico_snapshot.sql', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada')
exige(/REVOKE ALL ON TABLE public\.erp_dev_codes_snapshot FROM PUBLIC, anon, authenticated/.test(sql), 'REVOKE anon na tabela')
exige(/fn_dev_painel_pode_ver\(\)/.test(sql), 'policy da equipe PS')
exige(/REVOKE ALL ON FUNCTION public\.fn_dev_codes_snapshot_gravar\(\) FROM PUBLIC, anon, authenticated/.test(sql), 'REVOKE da função')
exige(/\*\/15 \* \* \* \*/.test(sql), 'agendamento a cada 15 min')
exige(!/\b(UPDATE|DELETE)\b[^;]*erp_(agente|dev_entrega)/i.test(sql.replace(/DELETE FROM erp_dev_codes_snapshot/g, '')), 'só leitura das fontes')
if (falhas.length) { console.error('check-codes-historico-snapshot FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-codes-historico-snapshot ok')
