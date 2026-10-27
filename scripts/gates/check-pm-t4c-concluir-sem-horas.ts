// Gate · PM-T (4c) — concluir job sem horas pede apontamento. Sem rede.
import { readFileSync } from 'node:fs'
import { exigeApontamentoAoConcluir } from '../../src/lib/pm/cronometroAuto'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
ok(exigeApontamentoAoConcluir('concluida', 0), 'concluída sem horas → pede apontamento')
ok(!exigeApontamentoAoConcluir('concluida', 2.5), 'concluída com horas → não pede')
ok(!exigeApontamentoAoConcluir('em_producao', 0), 'outra situação → não pede')
const pg = readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8')
ok(/<AvisoSemHoras /.test(pg) && /totalHorasDoJob/.test(pg), 'Pauta mostra o aviso ao concluir')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
