// Gate (HB0 · HBF-0.3, empresa DEMO irrigada) — a semente da Construtora DEMO grava o BDI dos itens coerente com o preço
// que ela mesma calcula (custo × 1,35 → BDI 35%) e não abaixo do BDI padrão da empresa (31,86%). Antes saía 20 e a tela
// de Propostas acusava todas as propostas DEMO como "abaixo do padrão". Sem rede: lê a migration e a regra única da tela.
import { readFileSync } from 'node:fs'
import { situacaoBdi } from '../../src/lib/hub/propostas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024160000_hb0_demo_bdi_coerente.sql', 'utf8')
const corpo = mig.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')

ok(corpo.includes("'round(s.custo_unitario_total*1.35,2), s.custo_unitario_total, 35,'"), 'itens da obra (fn_gold_hub_seed_reparar) passam a BDI 35')
ok(/E' {11}35, round\(\(round\(s\.custo_unitario_total \* 1\.35, 2\)/.test(corpo), 'proposta enviada (fn_demo_seed_construtora) passa a BDI 35')
ok(corpo.includes("E'SELECT c, 31.86 WHERE NOT EXISTS'"), 'BDI padrão criado na DEMO sem configuração = 31,86')
ok((corpo.match(/RAISE EXCEPTION/g) ?? []).length === 3, 'patch por âncora: aborta se qualquer das 3 âncoras sumir')
ok(Math.round((1.35 - 1) * 100) === 35, 'BDI 35 = preço da semente (custo × 1,35) ÷ custo − 1')
ok(situacaoBdi(35, 31.86) !== 'abaixo' && situacaoBdi(35, 28.5) !== 'abaixo', 'BDI 35 não fica abaixo do padrão (31,86 ou o antigo 28,50)')
ok(situacaoBdi(20, 31.86) === 'abaixo', 'o BDI antigo (20) era acusado como abaixo do padrão — o defeito que a migration corrige')

// RD-55: só a demo 006 é tocada; nenhum UPDATE sem a empresa demo no WHERE; nada de DELETE/TRUNCATE
const updates = corpo.match(/UPDATE [\s\S]*?;/g) ?? []
ok(updates.length === 2 && updates.every(u => u.includes("company_id = 'b0700000-0000-4000-a000-000000000006'") && u.includes('bdi_percentual = 20')), 'UPDATE só na DEMO 006 e só onde o BDI é 20')
ok(corpo.includes("is_demo IS TRUE"), 'alinhamento só roda se a 006 for demo')
ok(!/\b(DELETE|TRUNCATE|DROP)\b/i.test(corpo), 'sem DELETE/TRUNCATE/DROP')
ok(/UPDATE erp_orcamentos_itens SET bdi_percentual = 35\s/.test(corpo) && !/SET[^;]*(preco_unitario|subtotal|preco_custo)/.test(corpo), 'preço, custo e subtotal não mudam (total das propostas igual)')

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-demo-bdi-coerente`); process.exit(1) }
console.log('\ncheck-hub-demo-bdi-coerente: verde')
