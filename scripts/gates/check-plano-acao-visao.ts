/**
 * Gate (chamados #3177/#3181, Frioeste): plano de ação da Indústria com quadro arrastável + visão em tabela,
 * sem sobreposição de texto no cartão e com "?" (RD-95) da nova chave no banco.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const raiz = join(__dirname, '../..')
const tela = readFileSync(join(raiz, 'src/app/dashboard/industrial/plano-acao/page.tsx'), 'utf8')
const sql = readFileSync(join(raiz, 'supabase/migrations/20261017002010_plano_acao_visao_arrastar_ajuda.sql'), 'utf8')

ok(/draggable/.test(tela) && /onDragStart/.test(tela) && /onDrop=/.test(tela) && /onDragOver=/.test(tela), 'cartão arrastável e coluna aceita soltar')
ok(/destino === 'concluida'\) \{ setConcluir/.test(tela), 'soltar em Concluída pede o resultado (não pula a regra)')
ok(/mudarStatus\(p, destino\)/.test(tela), 'soltar em outra coluna muda o status pela RPC existente')
ok(/plano-visao-\$\{v\}/.test(tela) && /<TabelaAcoes/.test(tela), 'alternância Quadro/Tabela e tabela de ações')
ok(/overflowWrap: 'anywhere'/.test(tela) && /display: 'block'/.test(tela), 'título do cartão quebra linha sem sobrepor')
ok(/industrial\.plano_acao\.visao/.test(tela) && /industrial\.plano_acao\.visao/.test(sql), '"?" da visão na tela e no banco')
ok(!/DROP|DELETE|UPDATE|TRUNCATE/i.test(sql.replace(/ON CONFLICT[\s\S]*$/i, '')), 'migration aditiva')

if (falhas) { console.error(`\n[check-plano-acao-visao] ${falhas} regra(s) quebrada(s).`); process.exit(1) }
console.log('\n[check-plano-acao-visao] ok.')
