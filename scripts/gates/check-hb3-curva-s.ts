// Gate (HB3 fatia 6 · curva S do cronograma). Sem rede. Prova a conta da curva (tarefa única, peso por duração, linha de base,
// hoje fora da janela) e confere que a tela mostra a curva, com "?" nas chaves semeadas na migration.
import { readFileSync } from 'node:fs'
import { curvaS, planejadoEm, realizadoGeral } from '../../src/lib/hub/curvaS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const perto = (a: number, b: number) => Math.abs(a - b) < 0.01

const unica = [{ inicio: '2026-01-01', fim: '2026-01-10', percentual: 50 }]
ok(perto(planejadoEm(unica, '2026-01-05'), 50), 'tarefa única: metade do prazo = 50% planejado')
ok(perto(planejadoEm(unica, '2025-12-31'), 0) && perto(planejadoEm(unica, '2026-02-01'), 100), 'antes = 0%, depois = 100%')
const duas = [{ inicio: '2026-01-01', fim: '2026-01-10', percentual: 100 }, { inicio: '2026-01-11', fim: '2026-01-30', percentual: 0 }]
ok(perto(realizadoGeral(duas), 100 * 10 / 30), 'realizado pondera pela duração (10 de 30 dias = 33,3%)')
ok(perto(planejadoEm(duas, '2026-01-10'), 100 * 10 / 30), 'planejado pondera pela duração')
const base = [{ inicio: '2026-01-11', fim: '2026-01-20', percentual: 0, inicio_base: '2026-01-01', fim_base: '2026-01-10' }]
ok(perto(planejadoEm(base, '2026-01-10'), 100), 'planejado segue a linha de base, não a data atual')
const c = curvaS(unica, '2026-01-05')!
ok(perto(c.planejadoHoje, 50) && perto(c.realizado, 50) && perto(c.desvio, 0), 'em dia: desvio 0')
ok(c.pontos[0].data === '2026-01-01' && c.pontos[c.pontos.length - 1].data === '2026-01-10' && perto(c.pontos[c.pontos.length - 1].planejado, 100), 'série vai do início ao fim e termina em 100%')
ok(curvaS([], '2026-01-01') === null, 'sem tarefas = sem curva')
ok(perto(curvaS(unica, '2030-01-01')!.planejadoHoje, 100), 'hoje depois do fim = 100% planejado')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261022130030_hb3_cronograma_fatia6_curva_s_ajuda.sql', 'utf8')
ok(tela.includes("from '@/lib/hub/curvaS'") && tela.includes('curvaS('), 'a tela usa a lib da curva S')
for (const k of ['projetos.cronograma.curva_s', 'projetos.cronograma.ind_planejado', 'projetos.cronograma.ind_desvio']) {
  ok(tela.includes(`"${k}"`), `a tela mostra o "?" ${k}`)
  ok(mig.includes(`'${k}'`), `chave ${k} semeada na migration`)
}
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')

if (falhas) { console.error(`\n${falhas} falha(s) na curva S`); process.exit(1) }
console.log('\nCurva S do cronograma: ok')
