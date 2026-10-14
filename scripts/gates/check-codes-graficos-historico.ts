// Gate · gráficos do histórico da aba Codes (fatia 2): componente lê o snapshot, "?" de cada indicador existe na migration, sem emoji.
import { readFileSync } from 'node:fs'
const tsx = readFileSync('src/components/dev/GraficosHistoricoCodes.tsx', 'utf8')
const sql = readFileSync('supabase/migrations/20261014120005_dev_codes_graficos_historico_ajuda.sql', 'utf8')
const pai = readFileSync('src/components/dev/GraficosCodes.tsx', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/erp_dev_codes_snapshot/.test(tsx), 'lê o snapshot')
exige(/GraficosHistoricoCodes/.test(pai), 'montado na aba')
for (const c of [...tsx.matchAll(/chave="(dev\.codes\.graficos\.[a-z_]+)"/g)].map((m) => m[1])) exige(sql.includes(`'${c}'`), `"?" sem texto no banco: ${c}`)
exige(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(tsx), 'sem emoji')
if (falhas.length) { console.error('check-codes-graficos-historico FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-codes-graficos-historico ok')
