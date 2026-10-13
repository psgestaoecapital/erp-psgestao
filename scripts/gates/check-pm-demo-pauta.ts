// Gate · demonstração da Pauta P&M (PM-A, CEO 02/10). Sem rede. A migration do cenário da demo:
// 1) só mexe na demo da P&M (recusa qualquer outra empresa — nunca a Pdois nem cliente real);
// 2) é idempotente (marca 'demo-pauta', re-arma em vez de duplicar) e não apaga nada (RD-30);
// 3) tem atrasados, vence hoje, aguardando cliente, rodadas e "Meus" (CEO/robô) — o que a tela precisa mostrar;
// 4) sobrevive ao reset (encadeada no fn_demo_reset, RD-69) e não fica exposta a usuário (só service_role).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const mig = readFileSync('supabase/migrations/20261002200000_pm_demo_pauta_seed.sql', 'utf8')
const semComentarios = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

ok(/IF p_company_id IS DISTINCT FROM v_demo/.test(mig) && /is_demo IS TRUE/.test(mig), 'só a demo da P&M (e só se for is_demo)')
ok(/v_demo uuid := 'b0700000-0000-4000-a000-000000000002'/.test(mig), 'empresa fixa: Agência (P&M) - DEMO')
ok(!/\bDELETE\s+FROM\b/i.test(semComentarios) && !/\bTRUNCATE\b/i.test(semComentarios), 'nada é apagado (RD-30)')
ok(/'demo-pauta' = ANY \(tags\)/.test(mig) && /v_rearmados/.test(mig), 'idempotente: acha pela marca e re-arma, não duplica')
ok(/data_prazo = v_hoje \+ s\.dias/.test(mig), 'prazos relativos ao dia em que roda (o cenário não envelhece)')

const linhas = [...mig.matchAll(/\((\d{5}),(\d),(\d),'[^']+','([a-z_]+)',(-?\d+),'([A-Z])',(\d),(NULL|\d+),/g)]
  .map((m) => ({ n: m[1], st: m[4], dias: Number(m[5]), resp: m[6], rodada: Number(m[7]), aguard: m[8] }))
const fechado = (st: string) => st === 'concluida' || st === 'publicado'
ok(linhas.length >= 40, `cenário com ${linhas.length} jobs (≥ 40)`)
ok(new Set(linhas.map((l) => l.n)).size === linhas.length, 'números de job únicos')
ok(linhas.filter((l) => l.dias < 0 && !fechado(l.st)).length >= 5, 'pelo menos 5 atrasados (grupo "Atrasados" no topo)')
ok(linhas.filter((l) => l.dias === 0).length >= 3, 'pelo menos 3 vencem hoje')
ok(linhas.filter((l) => l.st === 'aguardando' && l.aguard !== 'NULL').length >= 3, '"aguardando cliente há N dias"')
ok(linhas.filter((l) => l.rodada > 0).length >= 3, 'rodadas de ajuste (código com letra A/B)')
ok(linhas.filter((l) => l.resp === 'G').length >= 3 && linhas.filter((l) => l.resp === 'R').length >= 3, '"Meus" funciona para o CEO e para o robô')
for (const st of ['nao_iniciada', 'em_producao', 'aguardando', 'em_aprovacao', 'concluida', 'publicado'])
  ok(linhas.some((l) => l.st === st), `aba "${st}" tem job`)

ok(/pg_get_functiondef\('public\.fn_demo_reset\(uuid\)'::regprocedure\)/.test(mig) && /fn_demo_seed_pm_pauta\(p_company_id\)/.test(mig),
  'encadeada no fn_demo_reset (sobrevive ao reset, RD-69)')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_pm_pauta\(uuid\) FROM PUBLIC, anon, authenticated;/.test(mig)
  && /GRANT EXECUTE ON FUNCTION public\.fn_demo_seed_pm_pauta\(uuid\) TO service_role;/.test(mig), 'só service_role executa')

ok(/SET excluido_em = now\(\)[\s\S]*titulo LIKE 'E2E Post Dia das Crianças %'[\s\S]*excluido_em IS NULL/.test(mig),
  'jobs de teste "E2E Post Dia das Crianças" vão para a lixeira (restaurável), só na demo')
const t144 = readFileSync('e2e/jornadas/aceitacao/pdois-job-ordem-144.spec.ts', 'utf8')
ok(/excluido_em: new Date\(\)\.toISOString\(\)/.test(t144), 'o teste #144 manda o próprio job para a lixeira no fim')

if (falhas) { console.error(`\ncheck-pm-demo-pauta: ${falhas} falha(s)`); process.exit(1) }
console.log('\nDemo da Pauta: ok')
