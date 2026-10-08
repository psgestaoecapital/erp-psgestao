// Gate PS EHS E0 (CEO 08/10): rótulo do menu "PS EHS" SEM mudar rota/chave; dicionário pt/en/es completo e sem chave faltando;
// design system presente e painel piloto usando-o (nenhuma função removida: ZIP, atalhos, alertas, matriz).
import { readFileSync } from 'node:fs'
import { EHS_DICT, EHS_LANGS, ehsT } from '../../src/lib/ehs/i18n'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ler = (p: string) => readFileSync(p, 'utf8')

const menu = ler('src/lib/menu/dashboard-menu-config.ts')
ok(/id: 'compliance',\s*label: 'PS EHS'/.test(menu), "menu: grupo id 'compliance' (chave intacta) com rótulo PS EHS")
ok(menu.includes("href: '/dashboard/compliance'"), 'menu: rota /dashboard/compliance intacta')
ok((menu.match(/href: '\/dashboard\/compliance[^']*'/g) ?? []).length >= 7, 'menu: as 7 telas do módulo continuam listadas')

const chavesPt = Object.keys(EHS_DICT.pt)
for (const l of EHS_LANGS) {
  const faltam = chavesPt.filter((k) => !EHS_DICT[l][k])
  ok(faltam.length === 0, `i18n ${l}: sem chave faltando ${faltam.join(',')}`)
}
ok(ehsT('es', 'chave.inexistente') === 'chave.inexistente', 'i18n: chave desconhecida devolve a própria chave')
ok(EHS_DICT.pt['marca.sub'] === 'Saúde, Segurança e Meio Ambiente', 'subtítulo oficial em pt')

const ui = ler('src/components/ehs/ui.tsx')
for (const c of ['EhsHeader', 'EhsStatusCard', 'EhsAtalho', 'EhsTimeline', 'EhsSidePanel', 'EhsAssistente', 'EhsLangSwitch']) {
  ok(ui.includes(`export function ${c}`), `design system: ${c}`)
}
for (const cor of ['#3D2314', '#FAF7F2', '#C8941A']) ok(ui.includes(cor), `identidade PS ${cor}`)

const pg = ler('src/app/dashboard/compliance/page.tsx')
ok(pg.includes('EhsHeader') && pg.includes('useEhsLang'), 'painel piloto usa o design system e os idiomas')
for (const f of ['ZipModal', '/dashboard/compliance/matriz', '/dashboard/compliance/empresa', '/dashboard/compliance/funcionarios/${a.funcionario_id}', 'v_compliance_matriz_funcionarios'])
  ok(pg.includes(f), `painel piloto mantém: ${f}`)
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
