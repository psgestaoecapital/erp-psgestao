// Gate (PDCA Hub 23/10): Clientes de obra mostra o tipo PF/PJ certo (DEMO grava 'J'/'F'), iniciais reais,
// obras por cliente, e todo "?" da tela tem linha de ajuda numa migration.
import { readFileSync, readdirSync } from 'node:fs'
import { iniciais, obrasPorCliente, temContato, tipoPessoaNormal } from '../../src/app/dashboard/projetos/clientes/clientes-regras'
let falhas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FALHA'} ${m}`); if (!c) falhas++ }

ok(tipoPessoaNormal('J') === 'PJ' && tipoPessoaNormal('F') === 'PF', "legado 'J'/'F' vira PJ/PF")
ok(tipoPessoaNormal('PF') === 'PF' && tipoPessoaNormal('pj') === 'PJ', 'PF/PJ (qualquer caixa) mantém')
ok(tipoPessoaNormal(null, '123.456.789-01') === 'PF' && tipoPessoaNormal('', '12.345.678/0001-90') === 'PJ', 'sem tipo, o documento decide')
ok(tipoPessoaNormal(null, null) === 'PJ', 'sem tipo nem documento: PJ (padrão do cadastro)')
ok(iniciais('Clínica Bem Viver') === 'CB' && iniciais('Mercado Central Demo') === 'MC', 'iniciais do nome real, não letra fixa')
ok(iniciais('Casa de Pedra') === 'CP' && iniciais('  ') === '?' && iniciais('ana') === 'A', 'iniciais pulam conectivo e tratam vazio')
const m = obrasPorCliente([{ cliente_id: 'a' }, { cliente_id: 'a' }, { cliente_id: 'b' }, { cliente_id: null }])
ok(m.a === 2 && m.b === 1 && Object.keys(m).length === 2, 'conta obras por cliente e ignora obra sem cliente')
ok(temContato({ email: 'x@y.com' }) && !temContato({ telefone: ' ', email: null }), 'contato: telefone, celular ou e-mail não vazio')

const tela = readFileSync('src/app/dashboard/projetos/clientes/page.tsx', 'utf8')
ok(!/\{c\.tipo_pessoa \|\| 'PJ'\}/.test(tela) && /tipoOf\(c\)/.test(tela), 'a tela usa o tipo normalizado')
ok(/obrasPorCliente\(/.test(tela) && /iniciais\(nomeOf\(c\)\)/.test(tela), 'a tela mostra obras por cliente e iniciais')
const chaves = new Set([...tela.matchAll(/(?:chave|ajuda)="(projetos\.clientes\.[^"]+)"/g)].map((x) => x[1]))
const sql = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const faltando = [...chaves].filter((k) => !sql.includes(`'${k}'`))
ok(chaves.size >= 20 && faltando.length === 0, `todo "?" da tela tem ajuda em migration (${chaves.size} chaves${faltando.length ? '; faltam ' + faltando.join(', ') : ''})`)
if (falhas) process.exit(1)
