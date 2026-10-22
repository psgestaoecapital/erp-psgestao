// Gate (P&M da Pdois, onda 1 — mapeamento do SIGA, Parte S): a Margem por Job também é vista por cliente, serviço e
// fee. O grupo soma valor, custo e lucro só dos jobs com custo completo; os pendentes são contados à parte (RD-51);
// grupo sem nenhum job com custo não ganha margem. A tela usa a regra única e tem o "?" nos controles novos. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { calcularMargem, agruparMargem } from '../../src/lib/pm/margem'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const a1 = calcularMargem({ id: 'a1', valor_job: 1000, custo_estimado: null }, [{ job_id: 'a1', horas: 2, custo_hora: 100, custo_total: 200 }])
const a2 = calcularMargem({ id: 'a2', valor_job: 3000, custo_estimado: 1800 }, [])
const a3 = calcularMargem({ id: 'a3', valor_job: 500, custo_estimado: null }, []) // sem custo
const b1 = calcularMargem({ id: 'b1', valor_job: 2000, custo_estimado: 2500 }, [])
const c1 = calcularMargem({ id: 'c1', valor_job: 700, custo_estimado: null }, [{ job_id: 'c1', horas: 3, custo_hora: null, custo_total: null }])

const g = agruparMargem([
  { chave: 'cliA', linha: a1 }, { chave: 'cliA', linha: a2 }, { chave: 'cliA', linha: a3 },
  { chave: 'cliB', linha: b1 }, { chave: null, linha: c1 },
])
const A = g.find((x) => x.chave === 'cliA')!, B = g.find((x) => x.chave === 'cliB')!, N = g.find((x) => x.chave === null)!
ok(g.length === 3, 'um grupo por chave (job sem cliente/serviço/fee vira o grupo "sem")')
ok(A.jobs === 3 && A.valor === 4000 && A.custo === 2000 && A.lucro === 2000 && A.margem === 50 && A.pendentes === 1,
  'grupo soma só os jobs com custo completo; o job sem custo é contado à parte')
ok(B.lucro === -500 && B.margem === -25, 'prejuízo aparece no grupo (margem negativa)')
ok(N.margem === null && N.pendentes === 1 && N.lucro === 0, 'grupo sem nenhum job com custo não ganha margem')
ok(g[0].chave === null && g[1].chave === 'cliB' && g[2].chave === 'cliA', 'ordem: sem margem primeiro (pendência), depois a pior margem')

const pagina = readFileSync('src/app/dashboard/pm/margem-job/page.tsx', 'utf8')
ok(pagina.includes('agruparMargem(') && !/lucro\s*\/\s*valor/.test(pagina), 'a tela agrupa pela regra única (sem conta própria)')
for (const d of ['job', 'cliente', 'servico', 'fee']) ok(pagina.includes(`v: '${d}'`), `a tela oferece ver por ${d}`)
const chaves = ['pm.margem.ver_por', 'pm.margem.grupo']
const migs = readdirSync('supabase/migrations').map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const k of chaves) ok(pagina.includes(`chave="${k}"`) && migs.includes(`'${k}'`), `"?" ${k} na tela e no banco (RD-95)`)

if (falhas) { console.error(`\ncheck-pm-margem-agrupada: ${falhas} falha(s)`); process.exit(1) }
console.log('\nP&M · margem por cliente/serviço/fee: ok')
