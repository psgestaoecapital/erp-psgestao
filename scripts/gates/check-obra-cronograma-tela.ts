// Gate (HB3 fatia 2 · tela do cronograma da obra). Sem rede. A tela grava só pelas funções com guarda, todo campo tem "?"
// com chave semeada na migration, a tela está em system_screens e o cockpit leva até ela.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261021130030_hb3_cronograma_tela_ajuda.sql', 'utf8')
const cockpit = readFileSync('src/app/dashboard/projetos/obras/[id]/cockpit/page.tsx', 'utf8')

ok(!/\.(insert|update|delete|upsert)\(/.test(tela), 'a tela não grava direto nas tabelas')
for (const fn of ['fn_obra_tarefa_salvar', 'fn_obra_tarefa_excluir', 'fn_obra_tarefa_dependencia_salvar', 'fn_obra_cronograma_linha_base'])
  ok(tela.includes(fn), `a tela usa ${fn}`)
const chaves = [...tela.matchAll(/chave="(projetos\.cronograma\.[a-z_]+)"/g)].map((m) => m[1])
ok(chaves.length >= 8, `todo campo e ação tem "?" (${chaves.length} chaves)`)
for (const c of new Set(chaves)) ok(mig.includes(`'${c}'`), `chave ${c} semeada em erp_ajuda_campo`)
ok(/system_screens/.test(mig) && mig.includes('/dashboard/projetos/obras/[id]/cronograma'), 'tela registrada em system_screens')
ok(!/DELETE FROM|UPDATE public\./i.test(mig), 'migration só insere (aditiva)')
ok(cockpit.includes('/cronograma'), 'cockpit leva ao cronograma')
ok(!/\p{Extended_Pictographic}/u.test(tela.replace(/→|←/g, '')), 'sem emoji (RD-96)')

if (falhas) { console.error(`\n${falhas} falha(s) na tela do cronograma`); process.exit(1) }
console.log('\nTela do cronograma da obra: ok')
