// Gate · PM-T (6) — lançar falando: parser puro + tela. Sem rede.
import { readFileSync } from 'node:fs'
import { extrairHoras, acharJob, sugerirLancamento } from '../../src/lib/pm/lancarFalando'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
ok(extrairHoras('duas horas e meia no layout') === 2.5, '"duas horas e meia" → 2,5')
ok(extrairHoras('trabalhei 2h30 no job') === 2.5, '"2h30" → 2,5')
ok(extrairHoras('45 minutos de reunião') === 0.75, '45 min → 0,75')
ok(extrairHoras('1,5 h de revisão') === 1.5, '"1,5 h" → 1,5')
ok(extrairHoras('uma hora') === 1, '"uma hora" → 1')
ok(extrairHoras('meia hora') === 0.5, '"meia hora" → 0,5')
ok(extrairHoras('sem tempo nenhum') === null && extrairHoras('30 horas') === null, 'sem horas ou acima de 24 → null')
const jobs = [{ id: 'a', codigo: 'JOB-0123', titulo: 'Campanha Natal Frioeste' }, { id: 'b', codigo: 'JOB-0124', titulo: 'Site institucional' }]
ok(acharJob('2h no job-0123', jobs) === 'a', 'acha o job pelo código')
ok(acharJob('2h no site institucional', jobs) === 'b', 'acha o job pelo título')
ok(acharJob('2h em reunião', jobs) === null, 'ambíguo → null (a pessoa escolhe)')
ok(sugerirLancamento('  2h   layout ', jobs).descricao === '2h layout', 'descrição normalizada')
const pg = readFileSync('src/app/dashboard/pm/meu-dia/page.tsx', 'utf8')
ok(/<LancarFalando /.test(pg), 'Meu dia mostra o lançar falando')
const c = readFileSync('src/components/pm/LancarFalando.tsx', 'utf8')
ok(/BotaoDitar/.test(c) && /agency_timesheet/.test(c) && /Confira|Escolha o job/.test(c), 'dita, confere e grava no timesheet')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
