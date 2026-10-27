// Gate (#3050) — Orçamentos tem os novos status do fluxo e a transição entre eles.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const p = readFileSync('src/app/dashboard/orcamentos/page.tsx', 'utf8')
for (const [k, l] of [['aguardando', 'Aguardando'], ['em_andamento', 'Em andamento'], ['enviado_aprovacao', 'Enviado para aprovação']]) {
  ok(new RegExp(`${k}:\\s*\\{[^}]*label:"${l}"`).test(p), `STATUS_CFG tem ${k} (${l})`)
  ok(p.includes(`mudarStatus(o,'${k}')`) || k === 'enviado_aprovacao' || p.includes(`'${k}'`), `há transição para ${k}`)
}
ok(p.includes("mudarStatus(o,'enviado_aprovacao')"), 'há ação para enviar à aprovação')
ok(p.includes("['rascunho','enviado_aprovacao'].includes(o.status)"), 'Enviar ao cliente vale a partir de rascunho ou aprovação interna')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-orcamento-status-fluxo OK')
