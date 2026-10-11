// Gate HB2 fatia 1 — tabela de preço por cliente: migration (RLS por empresa, sem anon, sem escrita direta) e a regra
// de faixa + adicional (teste RD-83 da FC: 350 m² de Pintura Epóxi no sábado = faixa 100–500 × 1,5 = R$ 32,60/m²).
import { readFileSync, readdirSync } from 'node:fs'
import { escolherFaixa, precoUnitario } from '../../src/lib/hub/tabelaPreco'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_hb2_tabela_preco_cliente.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
ok(/^\d{8}\d{4}05_/.test(arq), 'migration na faixa 05 (gilberto-produto)')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids/.test(sql), 'RLS ligada com policy por empresa')
ok(/REVOKE ALL ON public\.%I FROM anon/.test(sql) && /REVOKE INSERT, UPDATE, DELETE/.test(sql), 'sem anon e sem escrita direta')
ok(!/\b(UPDATE|DELETE)\s+(FROM\s+)?public\./i.test(sql.replace(/REVOKE[^;]*;/g, '')), 'sem UPDATE/DELETE em dado')

const f = [
  { faixa_de: 0, faixa_ate: 100, preco_base: 25 },
  { faixa_de: 100, faixa_ate: 500, preco_base: 21.73 },
  { faixa_de: 500, faixa_ate: null, preco_base: 18 },
]
ok(escolherFaixa(f, 100)?.preco_base === 21.73, 'limite 100 cai na faixa 100–500')
ok(escolherFaixa(f, 99.9)?.preco_base === 25, 'abaixo de 100 → primeira faixa')
ok(escolherFaixa(f, 20000)?.preco_base === 18, 'faixa aberta no topo')
ok(precoUnitario(f, 350, { condicao: 'sabado', percentual: 50 }) === 32.6, '350 m² sábado = R$ 32,60')
ok(precoUnitario(f, 350, { condicao: 'noturno', percentual: 20 }) === 26.08, 'noturno +20%')
ok(precoUnitario(f, 350, { condicao: 'x', preco_fixo: 40 }) === 40, 'preço fixo por condição')
ok(precoUnitario(f, 350) === 21.73, 'condição normal sem adicional')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
