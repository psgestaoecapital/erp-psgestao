// Gate (HB3 fatia 7 · físico-financeiro do cronograma). Sem rede. Prova a conta (custo × prazo planejado, custo × avanço apropriado,
// linha de base, tarefa sem custo) e confere a migration (aditiva, com guarda de empresa, REVOKE anon) e o uso na tela.
import { readFileSync } from 'node:fs'
import { fisicoFinanceiro } from '../../src/lib/hub/fisicoFinanceiro'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const perto = (a: number, b: number) => Math.abs(a - b) < 0.01

const t = [{ inicio: '2026-01-01', fim: '2026-01-10', percentual: 50, custo_previsto: 1000 }]
const f = fisicoFinanceiro(t, '2026-01-05')!
ok(perto(f.previsto, 1000) && perto(f.planejadoHoje, 500) && perto(f.apropriado, 500) && perto(f.desvio, 0), 'em dia: planejado = apropriado')
ok(perto(fisicoFinanceiro([{ ...t[0], percentual: 20 }], '2026-01-05')!.desvio, -300), 'atrasada: desvio negativo em reais')
ok(fisicoFinanceiro([{ inicio: '2026-01-01', fim: '2026-01-10', percentual: 50 }], '2026-01-05') === null, 'sem custo em nenhuma tarefa = sem físico-financeiro')
ok(perto(fisicoFinanceiro([t[0], { inicio: '2026-01-01', fim: '2026-01-10', percentual: 100 }], '2026-01-10')!.previsto, 1000), 'tarefa sem custo conta zero')
const base = [{ inicio: '2026-01-11', fim: '2026-01-20', percentual: 0, inicio_base: '2026-01-01', fim_base: '2026-01-10', custo_previsto: '200' }]
ok(perto(fisicoFinanceiro(base, '2026-01-10')!.planejadoHoje, 200), 'planejado segue a linha de base; custo vindo como texto (numeric) funciona')

const mig = readFileSync('supabase/migrations/20261023141730_hb3_cronograma_fatia7_fisico_financeiro.sql', 'utf8')
const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
ok(/ADD COLUMN IF NOT EXISTS custo_previsto/.test(mig) && !/DELETE FROM|DROP /i.test(mig), 'migration aditiva (coluna nova, sem DROP/DELETE)')
ok(mig.includes('fn__guarda_empresa(v_company)') && mig.includes('REVOKE ALL ON FUNCTION public.fn_obra_tarefa_custo_salvar'), 'função com guarda de empresa e REVOKE anon')
ok(tela.includes('fn_obra_tarefa_custo_salvar') && tela.includes('fisicoFinanceiro('), 'a tela grava pela função e usa a lib')
for (const k of ['custo_previsto', 'ind_custo_previsto', 'ind_custo_apropriado', 'ind_custo_planejado']) {
  ok(tela.includes(`"projetos.cronograma.${k}"`) && mig.includes(`'projetos.cronograma.${k}'`), `"?" ${k} na tela e semeado`)
}

if (falhas) { console.error(`\n${falhas} falha(s) no físico-financeiro`); process.exit(1) }
console.log('\nFísico-financeiro do cronograma: ok')
