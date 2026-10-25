// Gate (HB4 · avanço físico pelo diário de obra). Sem rede. Prova a conta (executado ÷ meta da tarefa no item, teto de
// 100%, participação, peso por valor entre unidades diferentes, item ligado sem execução = 0%, diário sem quantidade e
// OS sem tarefa ignorados) e confere que o diário grava a quantidade pela função com guarda, a tela do cronograma só
// grava ao tocar em "Usar" (com confirmação) e os "?" estão semeados.
import { readFileSync, readdirSync } from 'node:fs'
import { avancoPeloDiario } from '../../src/lib/hub/avancoDiario'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tarefas = [{ id: 'T1', percentual: 80 }, { id: 'T2', percentual: 40 }, { id: 'T3', percentual: 0 }]
const itens = [
  { id: 'forro', quantidade_contratada: 165, valor_contratado: 14694.9 },
  { id: 'drywall', quantidade_contratada: 200, valor_contratado: 20000 },
  { id: 'porta', quantidade_contratada: 10, valor_contratado: 5000 },
]
const os = [
  { id: 'O1', tarefa_id: 'T1', obra_item_id: 'forro' },
  { id: 'O2', tarefa_id: 'T2', obra_item_id: 'drywall' },
  { id: 'O3', tarefa_id: 'T2', obra_item_id: 'porta' },
  { id: 'O4', tarefa_id: null, obra_item_id: 'forro' },
]

// forro sem participação cadastrada: a tarefa responde pelo item inteiro — 100 de 165 m² = 61%
const r1 = avancoPeloDiario(tarefas, itens, [], os, [{ os_id: 'O1', quantidade_executada: 40 }, { os_id: 'O1', quantidade_executada: 60 }])
ok(r1.length === 1 && r1[0].tarefa_id === 'T1' && r1[0].pct === 61 && r1[0].atual === 80 && r1[0].diarios === 2, 'soma os dias e divide pela quantidade do item (100/165 = 61%)')

// teto de 100%: lançar mais que o contratado não passa de 100%
ok(avancoPeloDiario(tarefas, itens, [], os, [{ os_id: 'O1', quantidade_executada: 999 }])[0]?.pct === 100, 'executado acima da meta fica em 100%')

// participação: a tarefa faz 50% do drywall (meta 100 m²); 50 m² = 50%
const v50 = [{ tarefa_id: 'T2', obra_item_id: 'drywall', participacao_pct: 50 }]
ok(avancoPeloDiario(tarefas, itens, v50, os, [{ os_id: 'O2', quantidade_executada: 50 }])[0]?.pct === 50, 'meta = contratado × participação da tarefa')

// unidades diferentes pesam pelo valor: drywall 100% (R$ 20.000) + porta 0% (R$ 5.000) = 80%
const vDois = [{ tarefa_id: 'T2', obra_item_id: 'drywall', participacao_pct: 100 }, { tarefa_id: 'T2', obra_item_id: 'porta', participacao_pct: 100 }]
ok(avancoPeloDiario(tarefas, itens, vDois, os, [{ os_id: 'O2', quantidade_executada: 200 }])[0]?.pct === 80, 'm² e un não se somam em quantidade: peso pelo valor (item ligado sem execução = 0%)')

// diário sem quantidade, quantidade zero e OS sem tarefa não contam; tarefa sem diário não aparece
const r5 = avancoPeloDiario(tarefas, itens, vDois, os, [
  { os_id: 'O2', quantidade_executada: null }, { os_id: 'O3', quantidade_executada: 0 }, { os_id: 'O4', quantidade_executada: 50 }, { os_id: 'X', quantidade_executada: 5 },
])
ok(r5.length === 0, 'diário sem quantidade, zero, OS sem tarefa e OS de fora são ignorados')
ok(avancoPeloDiario([], [], [], [], []).length === 0, 'sem dados = nada')
// item de quantidade zero não divide por zero
ok(avancoPeloDiario([{ id: 'T', percentual: 0 }], [{ id: 'z', quantidade_contratada: 0, valor_contratado: 0 }], [], [{ id: 'O', tarefa_id: 'T', obra_item_id: 'z' }], [{ os_id: 'O', quantidade_executada: 3 }]).length === 0, 'item com quantidade zero não entra (sem divisão por zero)')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const telaOs = readFileSync('src/app/dashboard/projetos/obras/os/page.tsx', 'utf8')
const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_hb4_rdo_quantidade_avanco.sql'))
ok(!!arq, 'migration do HB4 existe')
const mig = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''
ok(/ADD COLUMN IF NOT EXISTS quantidade_executada/.test(mig) && /quantidade_executada >= 0/.test(mig), 'coluna nova, opcional e não negativa')
ok(/fn_obra_rdo_salvar[\s\S]*fn__guarda_empresa/.test(mig) && /p_dados \? 'quantidade_executada'/.test(mig), 'diário grava pela função com guarda e a tela antiga não apaga a quantidade')
ok(!/DELETE FROM|DROP /i.test(mig.replace(/^--.*$/gm, '')), 'migration sem DELETE/DROP')
ok(/UPDATE projetos_obra_rdo x[\s\S]*x\.company_id = c[\s\S]*x\.criado_por IS NULL/.test(mig), 'UPDATE só nos diários da semente da DEMO')
for (const k of ['projetos.os_obra.rdo_quantidade', 'projetos.cronograma.avanco_diario', 'projetos.cronograma.avanco_diario_usar']) ok(mig.includes(`'${k}'`), `"?" ${k} semeado`)
ok(telaOs.includes('quantidade_executada: qtd') && telaOs.includes('chave="projetos.os_obra.rdo_quantidade"'), 'diário da OS envia a quantidade, com "?"')
ok(tela.includes("from '@/lib/hub/avancoDiario'") && tela.includes('chave="projetos.cronograma.avanco_diario"') && tela.includes('chave="projetos.cronograma.avanco_diario_usar"'), 'cronograma usa a lib e tem os "?"')
ok(/usarAvancoDiario[\s\S]*window\.confirm[\s\S]*rpc\('fn_obra_tarefa_salvar'/.test(tela), 'grava com confirmação e só pela função com guarda')
ok(/select\('os_id,quantidade_executada'\)/.test(tela) && !/select\('data,clima,praticavel,[^']*quantidade/.test(tela), 'quantidade em consulta à parte (histograma não quebra antes da migration)')

if (falhas) { console.error(`\n${falhas} falha(s) no avanço pelo diário`); process.exit(1) }
console.log('\nAvanço pelo diário: ok')
