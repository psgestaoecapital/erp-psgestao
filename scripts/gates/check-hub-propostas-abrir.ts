// Gate (HB0 item 4, CEO 21/10) — "Abrir" em Hub › Propostas leva o ?id= da proposta: o editor de orçamentos abre
// a proposta escolhida (deep-link) em vez de cair na lista genérica.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const lista = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
const editor = readFileSync('src/app/dashboard/orcamentos/page.tsx', 'utf8')
ok(/href=\{`\/dashboard\/orcamentos\?id=\$\{l\.id\}`\}[^>]*>Abrir<\/Link>/.test(lista), 'propostas: "Abrir" leva o ?id= da linha')
ok(!/<Link href="\/dashboard\/orcamentos"[^>]*>Abrir<\/Link>/.test(lista), 'propostas: nenhum "Abrir" sem id')
ok(/get\('id'\)/.test(editor) && /abrirEdicao\(o\)/.test(editor), 'editor: abre o orçamento do ?id= ao carregar')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
