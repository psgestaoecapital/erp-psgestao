// Gate (HB0, auditor F15 em /dashboard/projetos/propostas · "orçamento com itens reais") — cada proposta mostra a
// composição vinda dos itens (erp_orcamentos_itens): itens, quantos do catálogo, custo e margem. A margem é honesta:
// item sem custo deixa "sem custo" (nunca 100%). A tela usa a regra única (src/lib/hub/propostas.ts). Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { composicaoPorProposta, composicaoProposta, type ItemProposta } from '../../src/lib/hub/propostas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const it = (o: Partial<ItemProposta>): ItemProposta => ({ orcamento_id: 'a', quantidade: 1, preco_custo: null, subtotal: 0, servico_id: null, produto_id: null, ...o })

// ── caso conhecido: DEMO-ORC-001 da Construtora DEMO (dado vivo, 24/10) ──
const orc001 = [
  it({ quantidade: 165, preco_custo: 65.97, subtotal: 14694.90, servico_id: 's1' }),
  it({ quantidade: 190, preco_custo: 97.55, subtotal: 25021.10, servico_id: 's2' }),
]
const c1 = composicaoProposta(orc001)
ok(c1.preco === 39716 && c1.custo === 29419.55, 'DEMO-ORC-001: preço R$ 39.716,00 (= total) e custo 165×65,97 + 190×97,55 = R$ 29.419,55')
ok(c1.margemPct === 25.9, 'DEMO-ORC-001: margem (39.716 − 29.419,55) ÷ 39.716 = 25,9%')
ok(c1.itens === 2 && c1.doCatalogo === 2 && c1.semCusto === 0, 'DEMO-ORC-001: 2 itens, os 2 do catálogo')

// ── honestidade ──
const semCusto = composicaoProposta([it({ subtotal: 150, preco_custo: 0 })])
ok(semCusto.margemPct === null && semCusto.semCusto === 1, 'item com custo 0 → margem "sem custo" (null), nunca 100%')
ok(composicaoProposta([it({ subtotal: 100, preco_custo: 50, servico_id: 's' }), it({ subtotal: 100, preco_custo: null })]).margemPct === null, 'um item sem custo basta para não mostrar margem')
ok(composicaoProposta([]).margemPct === null && composicaoProposta([]).itens === 0, 'sem itens → sem margem')
ok(composicaoProposta([it({ quantidade: 2, preco_custo: 80, subtotal: 100, produto_id: 'p' })]).margemPct === -60, 'custo acima do preço → margem negativa (−60%), não escondida')
ok(composicaoProposta([it({ subtotal: 10, preco_custo: 5 }), it({ subtotal: 10, preco_custo: 5, produto_id: 'p' })]).doCatalogo === 1, 'item digitado à mão não conta como do catálogo')
const g = composicaoPorProposta([...orc001, it({ orcamento_id: 'b', subtotal: 150, preco_custo: 0 })].map((x, i) => (i < 2 ? { ...x, orcamento_id: 'a' } : x)))
ok(g.a?.margemPct === 25.9 && g.b?.margemPct === null && Object.keys(g).length === 2, 'agrupa os itens por proposta')

// ── tela ──
const src = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
ok(src.includes('composicaoPorProposta(') && src.includes("from('erp_orcamentos_itens')"), 'tela lê os itens e usa a regra única')
ok(!/margemPct\s*\?\?\s*100/.test(src) && src.includes('sem custo'), 'tela mostra "sem custo" quando a margem é null')
for (const id of ['hub-propostas-do-catalogo', 'hub-proposta-itens', 'hub-proposta-margem']) ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)
ok(src.includes('setCompErro(true)'), 'falha ao ler itens não derruba a lista nem inventa número')

// ── "?" (RD-95) na tela e em migration ──
const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['do_catalogo', 'composicao', 'margem'].map(c => `projetos.propostas.${c}`)) {
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-propostas-composicao`); process.exit(1) }
console.log('\ncheck-hub-propostas-composicao: verde')
