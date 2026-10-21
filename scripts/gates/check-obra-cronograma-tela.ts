// Gate (HB3 fatia 2 · tela do cronograma da obra). Sem rede. Confere: a tela só grava pelas funções da fatia 1,
// lê com filtro de exclusão lógica, todo campo tem "?" com chave semeada na migration e a tela está em system_screens.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261021120030_hb3_cronograma_tela_ajuda_menu.sql', 'utf8')

ok(!/\.(insert|update|delete|upsert)\(/.test(tela), 'a tela não grava direto nas tabelas')
for (const fn of ['fn_obra_tarefa_salvar', 'fn_obra_tarefa_excluir', 'fn_obra_tarefa_dependencia_salvar', 'fn_obra_cronograma_linha_base'])
  ok(tela.includes(fn), `a tela chama ${fn}`)
ok((tela.match(/is\('excluido_em', null\)/g) ?? []).length === 2, 'leituras ignoram o excluído')
const chaves = [...new Set([...tela.matchAll(/chave="([^"]+)"/g)].map((m) => m[1]))]
ok(chaves.length >= 8, `a tela usa ${chaves.length} chaves de ajuda`)
for (const c of chaves) ok(mig.includes(`'${c}'`), `chave ${c} semeada na migration`)
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')
ok(mig.includes("'/dashboard/projetos/obras/[id]/cronograma'"), 'tela cadastrada em system_screens')

if (falhas) { console.error(`\n${falhas} falha(s) na tela do cronograma`); process.exit(1) }
console.log('\nTela do cronograma: ok')
