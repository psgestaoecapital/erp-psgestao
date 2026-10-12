// Gate · PM-T (1) — ▶ nos cartões + cronômetro global no topo (CEO 06/10, blueprint 00.5-B). Sem rede.
// Um ativo por pessoa (linha aberta do timesheet), iniciar em outro job para o anterior, barra global no layout da P&M,
// ▶ no Meu dia e na Pauta, e as telas se avisam pelo evento (sem tabela nova).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

const lib = ler('src/lib/pm/cronometroGlobal.ts')
ok(/\.is\('fim_em', null\)/.test(lib) && /horas: 0,/.test(lib), 'cronômetro = linha aberta do timesheet')
ok(/if \(aberto\?\.job_id === jobId\) return \{\}/.test(lib) && /if \(aberto\) \{ const r = await pararCronometro\(aberto\)/.test(lib), 'iniciar em outro job para o anterior; no mesmo job não duplica')
ok(/horasDoCronometro\(aberto\.inicio_em, fim\)/.test(lib), 'horas gravadas com mínimo de 0,01 h')
const play = ler('src/components/pm/BotaoPlay.tsx')
ok(/aberto\?\.job_id === jobId/.test(play) && /pararCronometro\(aberto\) : await iniciarCronometro/.test(play), '▶ inicia, ■ para no job ativo')
ok(/addEventListener\(EVENTO_CRONOMETRO/.test(play), 'botões acompanham o cronômetro pelo evento')
const glob = ler('src/components/pm/CronometroGlobal.tsx')
ok(/sticky top-0/.test(glob) && /cronometro-global-parar/.test(glob) && /print:hidden/.test(glob), 'barra global fixa, com Parar, fora da impressão')
ok(/<CronometroGlobal \/>/.test(ler('src/app/dashboard/pm/layout.tsx')), 'barra global no layout de /dashboard/pm/*')
ok(/<BotaoPlay /.test(ler('src/app/dashboard/pm/meu-dia/page.tsx')) && /<BotaoPlay /.test(ler('src/app/dashboard/pm/pauta/page.tsx')), '▶ no Meu dia e na Pauta')
const cr = ler('src/components/pm/Cronometro.tsx')
ok(/avisarCronometro\(\)/.test(cr) && /addEventListener\(EVENTO_CRONOMETRO/.test(cr), 'cronômetro do job aberto fala com a barra global')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
