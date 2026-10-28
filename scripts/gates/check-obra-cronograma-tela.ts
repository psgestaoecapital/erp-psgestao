// Gate (HB3 fatia 2 · tela do cronograma da obra). Sem rede. Confere: a tela só grava pelas funções da fatia 1,
// lê com filtro de exclusão lógica, todo campo tem "?" com chave semeada na migration e a tela está em system_screens.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const lerMig = (ns: string[]) => ns.map((n) => readFileSync(`supabase/migrations/${n}.sql`, 'utf8')).join('\n')
const migTexto = ['20261021180030_hb3_cronograma_tela_ajuda_menu', '20261022100030_hb3_cronograma_fatia3_ajuda', '20261022130030_hb3_cronograma_fatia6_curva_s_ajuda', '20261024040000_hb3_cronograma_fatia8_caminho_critico_ajuda', '20261024200000_hb3_cronograma_fatia9_lookahead_ajuda', '20261024220000_hb3_cronograma_fatia11_histograma_ajuda']
const mig = lerMig(migTexto)
const migTodas = lerMig([...migTexto, '20261023141730_hb3_cronograma_fatia7_fisico_financeiro', '20261024210000_hb3_cronograma_necessidades_periodo', '20261025000000_hb3_cronograma_fatia12_avanco_historico', '20261025010000_hb3_cronograma_fatia12_gantt_ajuda',
  // fatia 13 lida pelo sufixo: a fila pode renumerar a versão
  ...readdirSync('supabase/migrations').filter((f) => f.endsWith('_hb3_cronograma_fatia13_reprogramar_ajuda.sql') || f.endsWith('_hb4_rdo_quantidade_avanco.sql')).map((f) => f.replace(/\.sql$/, ''))])

ok(!/\.(insert|update|delete|upsert)\(/.test(tela), 'a tela não grava direto nas tabelas')
for (const fn of ['fn_obra_tarefa_itens_salvar', 'fn_obra_necessidades_periodo', 'fn_obra_tarefa_custo_salvar', 'fn_obra_tarefa_salvar', 'fn_obra_tarefa_excluir', 'fn_obra_tarefa_dependencia_salvar', 'fn_obra_cronograma_linha_base'])
  ok(tela.includes(fn), `a tela chama ${fn}`)
ok((tela.match(/is\('excluido_em', null\)/g) ?? []).length === 8, 'leituras ignoram o excluído')
const chaves = [...new Set([...tela.matchAll(/(?:chave|ajuda)="([^"]+)"/g)].map((m) => m[1]))]
ok(chaves.length >= 8, `a tela usa ${chaves.length} chaves de ajuda`)
for (const c of chaves) ok(migTodas.includes(`'${c}'`), `chave ${c} semeada na migration`)
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')
ok(mig.includes("'/dashboard/projetos/obras/[id]/cronograma'"), 'tela cadastrada em system_screens')

if (falhas) { console.error(`\n${falhas} falha(s) na tela do cronograma`); process.exit(1) }
console.log('\nTela do cronograma: ok')
