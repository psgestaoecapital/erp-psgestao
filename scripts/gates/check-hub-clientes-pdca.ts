// Gate (PDCA Hub 23/10): Clientes de obra mostra o tipo PF/PJ certo (DEMO grava 'J'/'F'), iniciais reais,
// obras por cliente, e todo "?" da tela tem linha de ajuda numa migration.
import { readFileSync, readdirSync } from 'node:fs'
import { brlCurto, comercialPorCliente, ganhasSemObra, iniciais, obraRecentePorCliente, obrasPorCliente, temContato, tipoPessoaNormal, valorOportunidade } from '../../src/app/dashboard/projetos/clientes/clientes-regras'
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

// PDCA 24/10 · elo comercial por cliente — caso conhecido da Construtora DEMO (C03 proposta 58 mil; C04 negociação 41 mil
// + prospecção 95 mil; C01 ganho 84 mil): em aberto = 58 + 136 = R$ 194 mil; ganho e perdido não somam.
const ops = [
  { id: 'o1', cliente_id: 'c1', etapa: 'ganho', valor_estimado: 84000, valor_proposta: null },
  { id: 'o3', cliente_id: 'c3', etapa: 'proposta_enviada', valor_estimado: 50000, valor_proposta: 58000 },
  { id: 'o4', cliente_id: 'c4', etapa: 'negociacao', valor_estimado: 41000, valor_proposta: null },
  { id: 'o5', cliente_id: 'c4', etapa: 'prospeccao', valor_estimado: 95000, valor_proposta: null },
  { id: 'o6', cliente_id: 'c4', etapa: 'perdido', valor_estimado: 999999, valor_proposta: null },
  { id: 'o7', cliente_id: null, etapa: 'negociacao', valor_estimado: 1, valor_proposta: null },
]
const cm = comercialPorCliente(ops, [{ cliente_id: 'c3' }, { cliente_id: 'c3' }, { cliente_id: 'c1' }, { cliente_id: null }],
  [{ oportunidade_id: 'o1' }, { oportunidade_id: 'o4' }, { oportunidade_id: 'o7' }, { oportunidade_id: null }])
ok(cm.c4.abertas === 2 && cm.c4.valorAberto === 136000 && cm.c4.ganhas === 0, 'em aberto soma as abertas e ignora perdida')
ok(cm.c3.valorAberto === 58000 && valorOportunidade(ops[1]) === 58000, 'valor da proposta vence o estimado')
ok(cm.c1.abertas === 0 && cm.c1.ganhas === 1 && cm.c1.valorAberto === 0, 'ganha conta como ganha, não como em aberto')
ok(cm.c3.propostas === 2 && cm.c1.propostas === 1 && cm.c1.visitas === 1 && cm.c4.visitas === 1, 'propostas e visitas por cliente (visita via oportunidade)')
ok(Object.values(cm).reduce((t, c) => t + c.valorAberto, 0) === 194000 && brlCurto(194000) === 'R$ 194 mil', 'total em aberto da DEMO = R$ 194 mil')
ok(brlCurto(1_250_000) === 'R$ 1,3 mi' && brlCurto(0).replace(/\s/g, ' ') === 'R$ 0,00', 'formato curto do valor')

// PDCA 24/10 06:03 · obra na linha e "ganha sem obra" (DEMO: Vista Verde 1 ganha / 1 obra em Chapecó; Tryo: 17 ganhas, 0 obras).
const rec = obraRecentePorCliente([
  { cliente_id: 'v', nome: 'Planta baixa – Forro', projeto_nome: null, obra_cidade: 'Chapecó', obra_uf: 'SC', created_at: '2026-10-01' },
  { cliente_id: 'v', nome: 'Obra antiga', projeto_nome: null, obra_cidade: 'Xaxim', obra_uf: null, created_at: '2026-09-01' },
  { cliente_id: 'h', nome: null, projeto_nome: 'Sala comercial', obra_cidade: null, obra_uf: null, created_at: null },
  { cliente_id: null, nome: 'sem cliente', projeto_nome: null, obra_cidade: null, obra_uf: null, created_at: '2026-12-01' },
])
ok(rec.v === 'Planta baixa – Forro · Chapecó/SC' && rec.h === 'Sala comercial' && Object.keys(rec).length === 2, 'linha mostra a obra mais recente com cidade/UF')
ok(ganhasSemObra(1, 1) === 0 && ganhasSemObra(17, 0) === 17 && ganhasSemObra(0, 3) === 0, 'ganha sem obra = ganhas além das obras abertas')

const tela = readFileSync('src/app/dashboard/projetos/clientes/page.tsx', 'utf8')
ok(!/\{c\.tipo_pessoa \|\| 'PJ'\}/.test(tela) && /tipoOf\(c\)/.test(tela), 'a tela usa o tipo normalizado')
ok(/comercialPorCliente\(/.test(tela) && /oportunidades\/\$\{o\.id\}/.test(tela) && /orcamentos\?id=\$\{x\.id\}/.test(tela), 'a tela liga cliente a oportunidade e proposta')
ok(/obrasPorCliente\(/.test(tela) && /iniciais\(nomeOf\(c\)\)/.test(tela), 'a tela mostra obras por cliente e iniciais')
ok(/obraRecentePorCliente\(/.test(tela) && /ganhasSemObra\(/.test(tela) && /novaObra\(c, op\)/.test(tela) && /is_demo/.test(tela), 'a tela mostra a obra na linha, avisa ganha sem obra, abre a obra da venda e sinaliza empresa demo')
const chaves = new Set([...tela.matchAll(/(?:chave|ajuda)="(projetos\.clientes\.[^"]+)"/g)].map((x) => x[1]))
const sql = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const faltando = [...chaves].filter((k) => !sql.includes(`'${k}'`))
ok(chaves.size >= 20 && faltando.length === 0, `todo "?" da tela tem ajuda em migration (${chaves.size} chaves${faltando.length ? '; faltam ' + faltando.join(', ') : ''})`)
if (falhas) process.exit(1)
