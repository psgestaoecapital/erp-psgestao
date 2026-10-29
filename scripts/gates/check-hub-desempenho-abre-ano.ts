// Gate (auditor em /dashboard/projetos/desempenho, 29/10) — a tela NÃO pode cair parada num mês vazio: se o mês corrente
// vem sem registro, abre sozinha no ano (uma vez, sem sobrescrever a escolha do usuário) e avisa por quê. Estático.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/projetos/desempenho/page.tsx', 'utf8')
ok(src.includes('periodoVazio(r?.resumo)') && src.includes("setPeriodo('ano')") && src.includes("setRange(preset('ano'))"), 'mês vazio → carregar() troca para o ano sozinho')
ok(src.includes('escolheuPeriodo') && (src.match(/escolheuPeriodo\.current = true/g) ?? []).length >= 4, 'escolha manual do período nunca é sobrescrita (e só tenta uma vez)')
ok(src.includes('data-testid="desempenho-aberto-no-ano"'), 'aviso "mostrando o ano porque o mês está vazio"')
ok(src.includes('data-testid="desempenho-vazio"'), 'estado vazio honesto continua para quando nem o ano tem dado')
ok(/<AjudaCampo chave="projetos\.desempenho\.periodo" \/>\s*<\/div>/.test(src), '"?" do período fica visível em todos os presets')
const mig = readdirSync('supabase/migrations').find((f) => f.includes('hub_desempenho_rd98_origem_dado'))
ok(!!mig && /fn_crm_desempenho/.test(readFileSync(`supabase/migrations/${mig}`, 'utf8')), 'origem do dado (RD-98 p3) em system_screens')
if (falhas) { console.error(`\ncheck-hub-desempenho-abre-ano: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-hub-desempenho-abre-ano: verde')
