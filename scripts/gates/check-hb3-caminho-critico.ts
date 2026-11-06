// Gate (HB3 fatia 8 · caminho crítico do cronograma). Sem rede. Prova a conta da folga (cadeia, ramo paralelo com folga,
// defasagem, sucessora começando antes da hora, sem dependência) e confere que a tela mostra o caminho com "?" semeado.
import { readFileSync } from 'node:fs'
import { caminhoCritico } from '../../src/lib/hub/caminhoCritico'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// A (1–10) → B (11–20); C (1–5) → B. C tem 5 dias de folga; A e B são críticas.
const t1 = [{ id: 'A', inicio: '2026-01-01', fim: '2026-01-10' }, { id: 'B', inicio: '2026-01-11', fim: '2026-01-20' }, { id: 'C', inicio: '2026-01-01', fim: '2026-01-05' }]
const d1 = [{ tarefa_id: 'B', predecessora_id: 'A', defasagem_dias: 0 }, { tarefa_id: 'B', predecessora_id: 'C', defasagem_dias: 0 }]
const r1 = caminhoCritico(t1, d1)
ok(r1.criticas.has('A') && r1.criticas.has('B') && !r1.criticas.has('C'), 'cadeia A→B é crítica; C fica fora')
ok(r1.folga.get('C') === 5 && r1.folga.get('A') === 0 && r1.folga.get('B') === 0, 'folga de C = 5 dias, A e B = 0')
ok(r1.fimObra === '2026-01-20', 'fim da obra = último fim')

// defasagem de 3 dias: A pode terminar até 3 dias antes do início de B menos 1 → B começa 14, A termina 10 → folga 0
const r2 = caminhoCritico([{ id: 'A', inicio: '2026-01-01', fim: '2026-01-10' }, { id: 'B', inicio: '2026-01-14', fim: '2026-01-20' }], [{ tarefa_id: 'B', predecessora_id: 'A', defasagem_dias: 3 }])
ok(r2.folga.get('A') === 0 && r2.criticas.has('A'), 'defasagem entra na conta (A sem folga)')

// sucessora começa antes de a predecessora terminar: folga negativa (conflito) e crítica
const r3 = caminhoCritico([{ id: 'A', inicio: '2026-01-01', fim: '2026-01-10' }, { id: 'B', inicio: '2026-01-08', fim: '2026-01-20' }], [{ tarefa_id: 'B', predecessora_id: 'A', defasagem_dias: 0 }])
ok(r3.folga.get('A') === -3 && r3.criticas.has('A'), 'conflito de datas vira folga negativa')

// tarefa solta que termina antes do fim da obra tem folga; a que termina no fim é crítica
const r4 = caminhoCritico([{ id: 'X', inicio: '2026-01-01', fim: '2026-01-31' }, { id: 'Y', inicio: '2026-01-01', fim: '2026-01-21' }], [])
ok(r4.folga.get('Y') === 10 && r4.criticas.has('X') && !r4.criticas.has('Y'), 'sem dependência: folga até o fim da obra')
ok(caminhoCritico([], []).fimObra === null, 'sem tarefas = sem caminho')
ok(caminhoCritico([{ id: 'A', inicio: '2026-01-01', fim: '2026-01-02' }], [{ tarefa_id: 'A', predecessora_id: 'Z', defasagem_dias: 0 }]).criticas.has('A'), 'dependência para tarefa excluída é ignorada')

const tela = readFileSync('src/app/dashboard/projetos/obras/[id]/cronograma/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261024040000_hb3_cronograma_fatia8_caminho_critico_ajuda.sql', 'utf8')
ok(tela.includes("from '@/lib/hub/caminhoCritico'") && tela.includes('caminhoCritico('), 'a tela usa a lib do caminho crítico')
for (const k of ['projetos.cronograma.ind_caminho_critico', 'projetos.cronograma.so_criticas']) {
  ok(tela.includes(`"${k}"`), `a tela mostra o "?" ${k}`)
  ok(mig.includes(`'${k}'`), `chave ${k} semeada na migration`)
}
ok(!/DELETE FROM|UPDATE public|DROP /i.test(mig), 'migration só aditiva')

if (falhas) { console.error(`\n${falhas} falha(s) no caminho crítico`); process.exit(1) }
console.log('\nCaminho crítico do cronograma: ok')
