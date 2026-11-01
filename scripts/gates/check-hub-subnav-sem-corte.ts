// Gate (HB0 · correção 9/10, auditor PDCA 24/10) — a sub-nav do Hub tem 15 abas numa linha. Com `overflow-x-auto` e sem
// quebra, a print do auditor (1440 com a sidebar) cortava a aba no meio ("Insu…") em várias telas do Hub. No desktop as
// abas quebram em linhas; no celular a rolagem horizontal fica, mas a aba ativa é levada para a vista. Sem rede: lê o layout.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/dashboard/projetos/layout.tsx', 'utf8')

const nav = src.match(/data-testid="hub-subnav"\s+className="([^"]+)"/)?.[1] ?? ''
ok(nav !== '', 'sub-nav do Hub marcada com data-testid="hub-subnav"')
ok(/\bmd:flex-wrap\b/.test(nav), 'desktop: as abas quebram em linhas (md:flex-wrap) — nenhuma fica cortada')
ok(/\bmd:overflow-visible\b/.test(nav), 'desktop: sem rolagem escondida (md:overflow-visible)')
ok(/(^|\s)overflow-x-auto\b/.test(nav), 'celular: rolagem horizontal mantida (overflow-x-auto)')
ok(/ref=\{navRef\}/.test(src), 'sub-nav tem ref para achar a aba ativa')
ok(/aria-current=\{isActive \? "page" : undefined\}/.test(src), 'aba ativa marcada com aria-current="page"')
ok(/querySelector<HTMLElement>\('\[aria-current="page"\]'\)/.test(src) && /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/.test(src),
  'celular: a aba ativa é rolada para a vista')
ok(/\}, \[pathname\]\);/.test(src), 'a rolagem acompanha a troca de rota')
ok(/className="ml-auto shrink-0 pl-3"/.test(src), 'Configurações não encolhe nem corta')
ok((src.match(/whitespace-nowrap/g) ?? []).length >= 1, 'rótulo da aba não quebra no meio da palavra')

// as 15 abas continuam lá (nenhuma sumiu com a mudança)
const abas = [...src.matchAll(/\{ href: "(\/dashboard\/projetos[^"]*)",\s+label: "([^"]+)"/g)].map(m => m[2])
ok(abas.length === 15, `15 abas nos grupos (achou ${abas.length})`)
ok(/label: "Configurações"/.test(src), 'aba Configurações presente')
for (const l of ['Insumos', 'Mão de obra', 'Calculadora', 'Obras', 'Viagens', 'Resultado', 'Cockpit']) ok(abas.includes(l), `aba "${l}" presente`)

if (falhas) { console.error(`check-hub-subnav-sem-corte: ${falhas} falha(s)`); process.exit(1) }
console.log('check-hub-subnav-sem-corte: OK')
