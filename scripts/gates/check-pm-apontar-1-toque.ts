// Gate · P&M — apontamento de horas em 1 toque (onda 2 da P&M da Pdois, Parte S, atrito 18). Sem rede.
// (1) o link "Lançar horas"/"apontar" (?job=) já abre com o job escolhido; (2) atalhos +15 min/+30 min/+1 h/+2 h gravam
// com 1 toque; (3) ▶ na fila pessoal (Meus trabalhos); (4) todo "?" novo tem chave na migration (RD-95).
import { readFileSync, readdirSync } from 'node:fs'
import { ATALHOS_HORAS, jobDoLink } from '../../src/lib/pm/apontamentoRapido'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

const jobs = [{ id: 'a1' }, { id: 'b2' }]
ok(jobDoLink('?job=b2', jobs) === 'b2', 'link com job da empresa → job escolhido')
ok(jobDoLink('?job=zz', jobs) === '' && jobDoLink('', jobs) === '' && jobDoLink('?job=', jobs) === '', 'link sem job ou de outra empresa → nada escolhido')
ok(ATALHOS_HORAS.map((a) => a.horas).join(',') === '0.25,0.5,1,2', 'atalhos 15 min, 30 min, 1 h e 2 h')

const pag = ler('src/app/dashboard/pm/apontamento-horas/page.tsx')
ok(/jobDoLink\(window\.location\.search/.test(pag), 'Apontamento lê o ?job= do link')
ok(/ATALHOS_HORAS\.map/.test(pag) && /onClick=\{\(\) => void gravar\(a\.horas\)\}/.test(pag), 'atalho grava direto (1 toque)')
const mt = ler('src/app/dashboard/pm/meus-trabalhos/page.tsx')
ok(/<BotaoPlay /.test(mt), '▶ em Meus trabalhos (fila pessoal)')

const usadas = new Set([...(pag + mt).matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1]))
const dir = 'supabase/migrations'
const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => ler(`${dir}/${f}`)).join('\n')
for (const c of usadas) ok(sql.includes(`'${c}'`), `chave "?" ${c} cadastrada em migration`)

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
