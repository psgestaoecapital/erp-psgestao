// Gate (Eng. Chefe 28/10, PR #3399) — prova ESTÁTICA do caminho principal da área "Logística" da Indústria (Frota e
// Viagens), pedida pela Frioeste. É um gate porque a aceitação e2e depende do banco de testes (abortado/ informativa
// desde 22/10): a prova do caminho não pode ficar refém de infra. Aqui provamos, só lendo os arquivos (sem rede, sem
// banco):
//   1. MENU/ROTAS — a migration cadastra as duas telas no module_catalog (área industrial, subgrupo logistica) e as
//      liga ao plano industrial (v15_industrial_grande), e o rótulo "Logística" aparece no menu lateral.
//   2. TELAS VIVAS (RD-98) — as duas telas entram em system_screens (área industrial, estado 'pronto', prioridade
//      válida — nunca 'normal') com a origem do dado (views_consumidas + rpcs_chamadas).
//   3. REUSO SEM DUPLICAR — as rotas da Indústria reexportam o MESMO componente do Hub (nada de tela paralela).
//   4. RD-97 (sem regressão) — a tela compartilhada do Hub /dashboard/projetos/viagens segue a empresa ESCOLHIDA
//      (sel), não a primeira da lista (companyIds[0]), como a Frota já fazia; e continua exportando a página.
// Sem rede, sem banco, sem variável da Vercel.
import { readFileSync, existsSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

const MIG = 'supabase/migrations/20261029220100_industria_logistica_frota_viagens.sql'
const ROTA_FROTA = 'src/app/dashboard/industrial/logistica/frota/page.tsx'
const ROTA_VIAGENS = 'src/app/dashboard/industrial/logistica/viagens/page.tsx'
const HUB_FROTA = 'src/app/dashboard/projetos/frota/page.tsx'
const HUB_VIAGENS = 'src/app/dashboard/projetos/viagens/page.tsx'
const MENU = 'src/lib/menu/useSidebarModulos.ts'

// ── 1) MENU / ROTAS ──────────────────────────────────────────────────────────
const mig = ler(MIG)
ok(mig.length > 0, `migration da Logística existe (${MIG})`)
for (const [id, rota] of [
  ['industrial_logistica_frota', '/dashboard/industrial/logistica/frota'],
  ['industrial_logistica_viagens', '/dashboard/industrial/logistica/viagens'],
] as const) {
  ok(mig.includes(`'${id}'`) && mig.includes(`'${rota}'`),
    `module_catalog: entrada ${id} na rota ${rota}`)
}
ok(/module_catalog[\s\S]*'industrial'[\s\S]*'logistica'/.test(mig),
  'module_catalog: área industrial, subgrupo logistica')
ok(mig.includes("'v15_industrial_grande'") && /plan_modules/.test(mig),
  'plan_modules: as duas telas ligadas ao plano industrial (v15_industrial_grande = Frioeste)')
const menu = ler(MENU)
ok(/LOGISTICA:\s*'Logística'/.test(menu), `menu lateral: rótulo "Logística" (${MENU})`)

// ── 2) TELAS VIVAS (RD-98) ───────────────────────────────────────────────────
const PRIORIDADES_VALIDAS = ['critica', 'alta', 'media', 'baixa']
for (const [sid, rota] of [
  ['dashboard.industrial_logistica_frota', '/dashboard/industrial/logistica/frota'],
  ['dashboard.industrial_logistica_viagens', '/dashboard/industrial/logistica/viagens'],
] as const) {
  // bloco do INSERT ... SELECT desta tela (até o WHERE NOT EXISTS que o fecha)
  const i = mig.indexOf(`'${sid}'`)
  const bloco = i >= 0 ? mig.slice(i, mig.indexOf('WHERE NOT EXISTS', i) + 120) : ''
  ok(bloco.length > 0 && bloco.includes(`'${rota}'`), `system_screens: tela ${sid} na rota ${rota}`)
  ok(/'industrial'/.test(bloco) && /'pronto'/.test(bloco), `system_screens ${sid}: área industrial, estado 'pronto'`)
  const prior = bloco.match(/'pronto'\s*,\s*'([a-z]+)'/)?.[1] ?? ''
  ok(PRIORIDADES_VALIDAS.includes(prior) && prior !== 'normal',
    `system_screens ${sid}: prioridade_monitoramento '${prior || '—'}' válida (nunca 'normal')`)
  ok(/views_consumidas/i.test(mig) && /ARRAY\[/.test(bloco), `system_screens ${sid}: origem do dado (views/rpcs) preenchida`)
}

// ── 3) REUSO SEM DUPLICAR ─────────────────────────────────────────────────────
for (const [rota, alvo, hub] of [
  [ROTA_FROTA, '@/app/dashboard/projetos/frota/page', HUB_FROTA],
  [ROTA_VIAGENS, '@/app/dashboard/projetos/viagens/page', HUB_VIAGENS],
] as const) {
  const src = ler(rota)
  ok(new RegExp(`export\\s*\\{\\s*default\\s*\\}\\s*from\\s*'${alvo.replace(/[/@-]/g, '\\$&')}'`).test(src),
    `rota ${rota} reexporta o componente do Hub (sem tela paralela)`)
  ok(ler(hub).length > 0, `componente do Hub reusado existe (${hub})`)
}

// ── 4) RD-97: sem regressão na tela compartilhada do Hub (viagens) ─────────────
const viagens = ler(HUB_VIAGENS)
ok(/export default function ViagensPage/.test(viagens), 'tela compartilhada /projetos/viagens segue exportando a página')
ok(/const\s+empresa\s*=\s*sel\b/.test(viagens) && !/const\s+empresa\s*=\s*companyIds\??\.?\[0\]/.test(viagens),
  'RD-97: /projetos/viagens usa a empresa ESCOLHIDA (sel), não a primeira da lista (companyIds[0])')

if (falhas) {
  console.error(`\n${falhas} falha(s): a área Logística da Indústria (#3399) não está provada no caminho principal.`)
  process.exit(1)
}
console.log('\n✓ Logística da Indústria (#3399): menu+rotas, telas vivas (RD-98), reuso do Hub e RD-97 provados.')
