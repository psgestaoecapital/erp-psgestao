// Gate (desenvolvedor_4_g, caixa 50de72f9): cálculo de custo de viagem — rateio entre obras e relatório que bate 1:1 com
// o Resultado da obra. Sem rede: confere a conta pura (src/lib/viagem/rateio.ts) e as regras da migration.
import { readFileSync } from 'node:fs'
import { dividirRateio, validarRateio, custoKm, kmRateado } from '../../src/lib/viagem/rateio'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const soma = (xs: { valor: number }[]) => Math.round(xs.reduce((a, x) => a + x.valor, 0) * 100) / 100

// gabarito: 245,00 em 33,33 / 33,33 / 33,34 → 81,66 + 81,66 + 81,68 (provado no banco local, mesma conta)
const g = dividirRateio(245, [{ obra_id: 'a', percentual: 33.33 }, { obra_id: 'b', percentual: 33.33 }, { obra_id: 'c', percentual: 33.34 }])
ok(g.map(p => p.valor).join('|') === '81.66|81.66|81.68', 'rateio 245,00 em 33,33/33,33/33,34 = 81,66 + 81,66 + 81,68')
const c = dividirRateio(100, [{ obra_id: 'a', percentual: 33.33 }, { obra_id: 'b', percentual: 33.33 }, { obra_id: 'c', percentual: 33.34 }])
ok(soma(c) === 100 && c[2].valor === 33.34, 'rateio 100,00 fecha em 100,00 (centavo na maior parte)')
ok(soma(dividirRateio(94.5, [{ obra_id: 'a', percentual: 70 }, { obra_id: 'b', percentual: 30 }])) === 94.5, 'abastecimento 94,50 em 70/30 fecha')
for (const v of [0.03, 10.01, 984.05, 1287.75]) ok(soma(dividirRateio(v, [{ obra_id: 'a', percentual: 50 }, { obra_id: 'b', percentual: 50 }])) === v, `50/50 de ${v} fecha`)
ok(validarRateio([{ obra_id: 'a', percentual: 60 }, { obra_id: 'a', percentual: 30 }]).length === 2, 'recusa soma ≠ 100% e obra repetida')
ok(validarRateio([{ obra_id: 'a', percentual: 60 }, { obra_id: 'b', percentual: 40 }]).length === 0, 'aceita 60/40')
ok(custoKm(984.05, 288) === 3.42 && custoKm(303.7, null) === null, 'custo/km da semente DEMO: 984,05 ÷ 288 = 3,42; sem km = vazio')
ok(kmRateado(288, 955.7, 984.05) === 279.7 && kmRateado(288, 28.35, 984.05) === 8.3, 'km rateado: 279,7 + 8,3 = 288')

const sql = readFileSync('supabase/migrations/20261025020052_viagem_custo_rateio_relatorio.sql', 'utf8')
ok(/fn__guarda_empresa\(v_l\.company_id\)/.test(sql), 'ratear: guarda de empresa')
ok(/v_status <> 'aberta'/.test(sql) && /pagar_id IS NOT NULL/.test(sql), 'ratear: só viagem aberta e lançamento fora do financeiro')
ok(/SET excluido_em = now\(\), excluido_por = auth\.uid\(\)/.test(sql) && !/DELETE FROM/i.test(sql), 'ratear: original excluído logicamente (RD-30), sem DELETE')
ok(/ORDER BY pct DESC, ord DESC LIMIT 1/.test(sql), 'ratear: centavos na maior parte (empate: a última) — igual ao TS')
ok(/public\.v_obra_resultado r/.test(sql) && /'bate'/.test(sql), 'relatório: confere com v_obra_resultado.custo_viagens')
ok(!/projetos_obra_rateio/.test(sql.replace(/--.*$/gm, '')), 'rateio de viagem não grava em projetos_obra_rateio (contaria duas vezes)')
ok(/SECURITY INVOKER/.test(sql) && /get_user_company_ids/.test(sql), 'relatório: só leitura com a RLS de quem chama e conferência de empresa')
ok((sql.match(/REVOKE ALL ON FUNCTION public\.fn_viagem_[a-z_]+\([^)]*\) FROM PUBLIC, anon;/g) ?? []).length === 2, 'as 2 funções sem anon')
for (const k of ['ratear_obra', 'ratear_percentual', 'rel_periodo', 'rel_custo_km', 'rel_km_rateado', 'rel_conferencia'])
  ok(sql.includes(`'projetos.viagem.${k}'`), `"?" RD-95: projetos.viagem.${k}`)

if (falhas) process.exit(1)
