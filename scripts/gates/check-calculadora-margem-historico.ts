// Gate (Hub · Calculadora Gold): margem sobre o preço + histórico de cálculos (migration e tela).
import { readFileSync } from 'node:fs'
import { precoComMargem } from '../../src/lib/calculadora/margem'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const v = precoComMargem(1000, 20)
ok(v?.preco === 1250 && v.lucro === 250, 'custo 1000 com margem 20% sobre o preço = 1250 (lucro 250)')
ok(precoComMargem(0, 30)?.preco === 0, 'custo zero não gera preço')
ok(precoComMargem(100, 0)?.preco === 100, 'margem 0 mantém o custo')
ok(precoComMargem(100, 100) === null && precoComMargem(100, -1) === null && precoComMargem(NaN, 10) === null, 'margem fora de 0–95% ou custo inválido é recusado')
const mig = readFileSync('supabase/migrations/20261024230035_hub_calculadora_historico.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_calc_historico FROM PUBLIC, anon/.test(mig), 'histórico: RLS ligada e REVOKE de anon')
ok(!/\b(UPDATE|DELETE)\b\s+(FROM\s+)?public\./i.test(mig), 'migration aditiva (sem UPDATE/DELETE em dado)')
const pg = readFileSync('src/app/dashboard/projetos/calculadora/page.tsx', 'utf8')
for (const k of ['margem', 'salvar_calculo', 'historico', 'adicionar_proposta']) ok(pg.includes(`projetos.calculadora.${k}`) && mig.includes(`projetos.calculadora.${k}`), `chave "?" ${k} na tela e no banco`)
if (falhas) process.exit(1)
