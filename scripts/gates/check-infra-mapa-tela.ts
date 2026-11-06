// Gate · Mapa da Infra (tela): rota, "?" (RD-95) com chave no banco, system_screens e RPCs certas.
import { readFileSync, existsSync } from 'node:fs'
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(existsSync('src/app/dashboard/dev/infra/page.tsx'), 'rota /dashboard/dev/infra')
const tsx = readFileSync('src/components/dev/InfraMapa.tsx', 'utf8')
const sql = readFileSync('supabase/migrations/20261029210600_dev_infra_mapa_tela.sql', 'utf8') + readFileSync('supabase/migrations/20261029210700_dev_infra_metas.sql', 'utf8') + readFileSync('supabase/migrations/20261029210900_dev_infra_alerta_chamados.sql', 'utf8')
for (const [, k] of tsx.matchAll(/chave="([^"]+)"/g)) exige(sql.includes(`'${k}'`), `chave de ajuda sem linha no banco: ${k}`)
exige(/fn_infra_mapa/.test(tsx) && /p_no:/.test(tsx) && /p_motivo:/.test(tsx), 'RPCs com parâmetros certos')
exige(/fn_infra_metas/.test(tsx) && /meta_publicacoes_hora/.test(tsx), 'metas da esteira (3 prontas, 4/h)')
exige(/fn_infra_chamados_por_code/.test(tsx) && /fn_infra_alerta_verificar/.test(sql) && /erp_truth_alerts/.test(sql), 'chamados por Code + alerta ao CEO')
exige(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/dev\/infra'/.test(sql), 'system_screens')
if (falhas.length) { console.error('check-infra-mapa-tela FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-infra-mapa-tela ok')
