// Gate · PM-T (4d) — resumo de fim do dia no Meu dia. Sem rede.
import { readFileSync } from 'node:fs'
import { horaDoResumo, sugestoesDoDia } from '../../src/lib/pm/resumoFimDia'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
ok(JSON.stringify(sugestoesDoDia([{ job_id: 'a' }, { job_id: 'a' }, { job_id: 'b' }], [{ job_id: 'b' }])) === '["a"]', 'sugere só job com ação e sem horas, sem repetir')
ok(sugestoesDoDia([], [{ job_id: 'x' }]).length === 0, 'sem ação → sem sugestão')
ok(!horaDoResumo(new Date('2026-10-07T15:00:00Z')) && horaDoResumo(new Date('2026-10-07T20:00:00Z')), 'só aparece a partir das 16h de Brasília')
const pg = readFileSync('src/app/dashboard/pm/meu-dia/page.tsx', 'utf8')
ok(/<ResumoFimDia /.test(pg), 'Meu dia mostra o resumo')
ok(/resumo-fim-dia/.test(readFileSync('src/components/pm/ResumoFimDia.tsx', 'utf8')), 'componente com data-testid')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
