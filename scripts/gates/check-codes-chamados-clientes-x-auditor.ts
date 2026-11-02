// Gate · painel de Codes separa chamados de clientes dos achados do Code-Auditor e a visão dos acordadores os exclui (RD-97).
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261017180000_dev_codes_chamados_clientes_x_auditor.sql', 'utf8')
const tsx = readFileSync('src/components/dev/GraficosHistoricoCodes.tsx', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/fn_dev_painel_pode_ver/.test(sql) && /REVOKE ALL ON FUNCTION public\.fn_dev_codes_chamados_clientes_x_auditor\(\) FROM PUBLIC, anon/.test(sql), 'RPC protegida (só equipe PS, sem anon)')
exige(/CREATE OR REPLACE VIEW public\.v_chamado_code_responsavel/.test(sql) && /NOT \(s\.agente = 'gilberto-produto' AND s\.area = 'hub_projetos'/.test(sql) && /AS esperando_ps/.test(sql), 'visão dos acordadores exclui o auditor e mantém esperando_ps')
exige(!/\b(DELETE|DROP|TRUNCATE)\b/i.test(sql.replace(/--.*$/gm, '')), 'sem DELETE/DROP/TRUNCATE')
exige(/fn_dev_codes_chamados_clientes_x_auditor/.test(tsx) && /data-testid="chamados-clientes"/.test(tsx) && /data-testid="achados-auditor"/.test(tsx), 'tela com os dois blocos distintos')
for (const c of ['dev.codes.graficos.chamados_clientes', 'dev.codes.graficos.achados_auditor']) exige(tsx.includes(`chave="${c}"`) && sql.includes(`'${c}'`), `"?" sem texto no banco: ${c}`)
if (falhas.length) { console.error('check-codes-chamados-clientes-x-auditor FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-codes-chamados-clientes-x-auditor ok')
