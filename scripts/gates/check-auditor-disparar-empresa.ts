// Gate (Eng. Chefe 17/10, PDCA do Hub): prova que a FOTO do auditor sai da empresa DEMO certa e não volta 403.
// O watcher (src/app/api/screen-watcher/playwright) recusa com 403 toda empresa que não seja is_demo. O disparo
// do auditor (fn_auditor_disparar) manda só { rota }, sem empresa; então o watcher precisa resolver a empresa de
// DEMONSTRAÇÃO pela ÁREA da rota (demo_por_area). Este gate garante:
//   1) areaDaRotaRobo extrai a área (2º segmento de /dashboard/<area>/...) e é fail-closed em lote divergente;
//   2) a área 'projetos' (rotas /dashboard/projetos/*) está mapeada em demo_por_area (migration);
//   3) o watcher usa o fallback por área (areaDaRotaRobo + demo_por_area).
// Estático (sem rede/banco). Não cita migration por NOME (a fila pode renumerar). Rodar local:
//   `npm run gates -- auditor-disparar-empresa`.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { areaDaRotaRobo } from '../../src/lib/gold/empresaDoPedidoRobo'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// (1) areaDaRotaRobo — função pura
ok(areaDaRotaRobo(['/dashboard/projetos/acompanhamento']) === 'projetos', "areaDaRotaRobo acha 'projetos' em /dashboard/projetos/acompanhamento")
ok(areaDaRotaRobo(['/dashboard/projetos/calculadora?company_id=x']) === 'projetos', 'areaDaRotaRobo ignora query string')
ok(areaDaRotaRobo(['/dashboard/financeiro/contas']) === 'financeiro', "areaDaRotaRobo acha 'financeiro'")
ok(areaDaRotaRobo(['/dashboard/projetos/a', '/dashboard/projetos/b']) === 'projetos', 'lote com a mesma área resolve')
ok(areaDaRotaRobo(['/dashboard/projetos/a', '/dashboard/financeiro/b']) === '', 'lote de áreas divergentes é fail-closed ("")')
ok(areaDaRotaRobo(['/dashboard']) === '', 'rota sem área é fail-closed ("")')

// (2) área 'projetos' mapeada em demo_por_area (alguma migration)
const DIR = join(__dirname, '..', '..', 'supabase', 'migrations')
const mapeiaProjetos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).some((f) => {
  const sql = readFileSync(join(DIR, f), 'utf8')
  return /demo_por_area/i.test(sql) && /'projetos'/.test(sql)
})
ok(mapeiaProjetos, "área 'projetos' mapeada em demo_por_area (migration)")

// (3) o watcher usa o fallback por área
const rota = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'api', 'screen-watcher', 'playwright', 'route.ts'), 'utf8')
ok(/areaDaRotaRobo\s*\(/.test(rota) && /demo_por_area/.test(rota), 'watcher resolve empresa DEMO pela área (areaDaRotaRobo + demo_por_area)')

if (falhas > 0) { console.error(`\ncheck-auditor-disparar-empresa: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-auditor-disparar-empresa: OK')
