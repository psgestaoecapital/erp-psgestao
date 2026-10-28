// Gate · Mapa da Infra (fatia 1): tabelas com RLS só equipe PS, REVOKE anon, escrita só service_role, config só PS_ADMIN.
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261029210500_dev_infra_mapa_desenho.sql', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada')
exige(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/.test(sql), 'REVOKE anon nas tabelas')
exige(/USING \(public\.fn_dev_painel_pode_ver\(\)\)/.test(sql), 'policy da equipe PS')
exige(/REVOKE ALL ON FUNCTION public\.fn_infra_batimento_registrar\([^)]*\) FROM PUBLIC, anon, authenticated/.test(sql), 'batimento só service_role')
exige(/papel = 'PS_ADMIN'/.test(sql), 'configuração só PS_ADMIN')
exige(/INSERT INTO public\.erp_infra_desenho_versao/.test(sql), 'versão do desenho')
exige(!/\b(UPDATE|DELETE)\b[^;]*erp_(agente|dev_entrega|esteira)/i.test(sql), 'só leitura das fontes existentes')
if (falhas.length) { console.error('check-infra-mapa-desenho FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-infra-mapa-desenho ok')
