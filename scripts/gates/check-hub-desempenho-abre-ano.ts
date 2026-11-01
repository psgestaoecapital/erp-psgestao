// Gate (auditor em /dashboard/projetos/desempenho, 29/10) — a tela NÃO pode cair parada num mês vazio: se o mês corrente
// vem sem registro, abre sozinha no ano (uma vez, sem sobrescrever a escolha do usuário) e avisa por quê. Estático.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/projetos/desempenho/page.tsx', 'utf8')
ok(src.includes('autoFeito') && src.includes("['ano', 'o ano', preset('ano')]"), 'mês sem venda fechada → carregar() amplia o período sozinho (trimestre → ano → 12 meses)')
ok(src.includes('autoFeito.current = true') && src.includes("periodo === 'mes'"), 'a abertura automática roda uma vez e só enquanto o período é o mês padrão')
ok(src.includes('data-testid="desempenho-auto-periodo"'), 'aviso "mostrando outro período porque o mês está sem vendas"')
ok(src.includes('data-testid="desempenho-vazio"'), 'estado vazio honesto continua para quando nem o ano tem dado')
ok(src.includes("{periodo !== 'custom' && <AjudaCampo chave=\"projetos.desempenho.periodo\" />}"), '"?" do período visível nos presets (e junto de cada data no personalizado)')
const mig = readdirSync('supabase/migrations').find((f) => f.includes('hub_desempenho_rd98_origem_dado'))
ok(!!mig && /fn_crm_desempenho/.test(readFileSync(`supabase/migrations/${mig}`, 'utf8')), 'origem do dado (RD-98 p3) em system_screens')
if (falhas) { console.error(`\ncheck-hub-desempenho-abre-ano: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-hub-desempenho-abre-ano: verde')
