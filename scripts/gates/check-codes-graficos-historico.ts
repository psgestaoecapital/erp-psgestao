// Gate · gráficos do histórico da aba Codes (fatia 2): componente lê o snapshot, "?" de cada indicador existe na migration, sem emoji.
import { readFileSync } from 'node:fs'
const tsx = readFileSync('src/components/dev/GraficosHistoricoCodes.tsx', 'utf8')
const sql = readFileSync('supabase/migrations/20261014120005_dev_codes_graficos_historico_ajuda.sql', 'utf8')
const sql3 = readFileSync('supabase/migrations/20261014140005_dev_codes_chamados_por_dia.sql', 'utf8')
const sql4 = readFileSync('supabase/migrations/20261017060000_dev_codes_chamados_ps_x_cliente.sql', 'utf8')
const pai = readFileSync('src/components/dev/GraficosCodes.tsx', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/erp_dev_codes_snapshot/.test(tsx), 'lê o snapshot')
exige(/GraficosHistoricoCodes/.test(pai), 'montado na aba')
for (const c of [...tsx.matchAll(/chave="(dev\.codes\.graficos\.[a-z_]+)"/g)].map((m) => m[1])) exige((sql + sql3 + sql4).includes(`'${c}'`), `"?" sem texto no banco: ${c}`)
exige(/fn_dev_codes_chamados_ps_x_cliente/.test(tsx) && /fn_dev_painel_pode_ver/.test(sql3) && /REVOKE ALL ON FUNCTION public\.fn_dev_codes_chamados_por_dia/.test(sql3) && sql3.includes("'dev.codes.graficos.chamados'"), 'chamados por dia: RPC protegida + "?"')
exige(/fn_dev_codes_chamados_ps_x_cliente/.test(tsx) && /fn_dev_codes_chamados_esperando_cliente/.test(tsx) && /fn_dev_painel_pode_ver/.test(sql4) && /REVOKE ALL ON FUNCTION public\.fn_dev_codes_chamados_ps_x_cliente/.test(sql4) && /interno/.test(sql4), 'chamados PS x cliente: RPCs protegidas, sem robô/interno')
exige(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(tsx), 'sem emoji')
if (falhas.length) { console.error('check-codes-graficos-historico FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-codes-graficos-historico ok')
