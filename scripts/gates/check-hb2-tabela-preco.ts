// Gate HB2 — tabela de preço por cliente: migration (RLS por empresa, sem anon) + regra de faixa/adicional (teste RD-83 da FC).
import { readFileSync, readdirSync } from 'node:fs'
import { precoDaTabela, type ItemTabela } from '../../src/lib/hub/tabelaPreco'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_hb2_tabela_preco_cliente.sql'))
ok(!!arq && /^\d{12}05_/.test(arq), `migration na faixa 05 (${arq ?? '—'})`)
const sql = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '') : ''
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON public\.%I FROM anon/.test(sql) && /get_user_company_ids/.test(sql), 'RLS ligada, policy por empresa, REVOKE anon')
ok(!/\b(UPDATE|DELETE FROM)\b/i.test(sql.replace(/ON DELETE CASCADE/gi, '')), 'migration aditiva (sem UPDATE/DELETE)')

const S = 's1'
const faixas = [[0, 100, 28.9], [100, 500, 21.73], [500, 1000, 18], [1000, null, 15]] as const
const itens: ItemTabela[] = faixas.map(([de, ate, p]) => ({ servico_id: S, faixa_de: de, faixa_ate: ate, preco_base: p }))
const regras = [{ condicao: 'noturno' as const, percentual: 20 }, { condicao: 'sabado' as const, percentual: 50 }, { condicao: 'domingo_feriado' as const, percentual: 100 }]
const codigos = [{ servico_id: S, condicao: 'sabado' as const, codigo_externo: 'BRF-123-S' }]

const a = precoDaTabela(itens, regras, codigos, { servico_id: S, quantidade: 350, condicao: 'sabado', custo_unitario: 20 })
ok(a?.preco === 32.6 && a.codigo === 'BRF-123-S' && a.total === 11410, '350 m² sábado = faixa 100–500 × 1,5 = R$ 32,60/m² com código do turno')
ok(precoDaTabela(itens, regras, codigos, { servico_id: S, quantidade: 100, condicao: 'normal' })?.preco === 28.9, 'limite 100 cai na faixa "até 100"')
ok(precoDaTabela(itens, regras, codigos, { servico_id: S, quantidade: 20000, condicao: 'domingo_feriado' })?.preco === 30, 'acima do teto: faixa aberta × 2,0')
ok(precoDaTabela(itens, regras, codigos, { servico_id: 'x', quantidade: 1, condicao: 'normal' }) === null, 'serviço fora da tabela → null')
const fx = precoDaTabela([{ ...itens[1], precos_fixos: { noturno: 40 } }], regras, [], { servico_id: S, quantidade: 200, condicao: 'noturno' })
ok(fx?.preco === 40 && fx.fixo, 'preço fixo por condição vence o percentual')
if (falhas) process.exit(1)
