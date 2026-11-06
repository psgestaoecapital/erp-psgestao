// Gate (HB0, auditor F15 em /dashboard/projetos/propostas · "BDI visível na proposta") — a lista mostra o BDI aplicado em
// cada proposta (médio ponderado pelo custo dos itens) contra o BDI padrão da empresa (projetos_modulo_config). Regra única
// em composicaoProposta/situacaoBdi (src/lib/hub/propostas.ts); BDI abaixo do padrão é sinalizado, nunca escondido. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { composicaoProposta, situacaoBdi, type ItemProposta } from '../../src/lib/hub/propostas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const item = (q: number, custo: number | null, bdi: number | null | undefined): ItemProposta =>
  ({ orcamento_id: 'P', quantidade: q, preco_custo: custo, subtotal: q * Number(custo ?? 0) * 1.3, servico_id: 's', produto_id: null, bdi_percentual: bdi })

const pond = composicaoProposta([item(1, 100, 20), item(3, 100, 40)])
ok(pond.bdiPct === 35 && pond.semBdi === 0, 'BDI ponderado pelo custo: (100×20 + 300×40) ÷ 400 = 35')
const simples = composicaoProposta([item(1, null, 10), item(1, 0, 30)])
ok(simples.bdiPct === 20, 'sem custo em nenhum item: média simples (20)')
const parcial = composicaoProposta([item(2, 50, 25), item(1, 80, null), item(1, 80, undefined)])
ok(parcial.bdiPct === 25 && parcial.semBdi === 2, 'item sem BDI conta em semBdi e fica fora da média')
const nenhum = composicaoProposta([item(1, 100, null)])
ok(nenhum.bdiPct === null && nenhum.semBdi === 1, 'nenhum item com BDI → null ("sem BDI")')
ok(composicaoProposta([]).bdiPct === null, 'proposta sem itens → null')
ok(composicaoProposta([{ ...item(1, 100, 20), bdi_percentual: '20.0000' as unknown as number }]).bdiPct === 20, 'BDI que chega como texto do banco (numeric) é lido')

ok(situacaoBdi(20, 31.86) === 'abaixo', '20% contra padrão 31,86% = abaixo (caso real da DEMO)')
ok(situacaoBdi(31.83, 31.86) === 'no_padrao', 'diferença de arredondamento (≤ 0,05 ponto) = no padrão')
ok(situacaoBdi(35, 31.86) === 'acima', 'acima do padrão não é acusado como falta')
ok(situacaoBdi(null, 31.86) === null && situacaoBdi(20, null) === null && situacaoBdi(20, 0) === null && situacaoBdi(20, undefined) === null, 'sem BDI ou sem padrão: não compara')

const src = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
ok(src.includes('situacaoBdi(') && src.includes("from('projetos_modulo_config')") && src.includes('bdi_percentual'), 'tela lê o BDI dos itens e o padrão da empresa e usa a regra única')
ok(src.includes("select('id,company_id,"), 'tela lê a empresa da proposta para comparar com o padrão certo')
ok(!/projetos_modulo_config[^\n]*\.(update|upsert|insert)\(/.test(src) && !/erp_orcamentos_itens[^\n]*\.(update|upsert|insert)\(/.test(src), 'só leitura: a tela não grava BDI')
for (const id of ['hub-proposta-bdi', 'hub-proposta-bdi-abaixo', 'hub-propostas-bdi-no-padrao']) ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)

const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['bdi', 'bdi_no_padrao'].map(c => `projetos.propostas.${c}`)) {
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-propostas-bdi`); process.exit(1) }
console.log('\ncheck-hub-propostas-bdi: verde')
