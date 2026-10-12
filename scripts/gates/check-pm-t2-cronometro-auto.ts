// Gate · PM-T (2) — início/fim do cronômetro sugerido pela situação do job, com confirmação. Sem rede.
import { readFileSync } from 'node:fs'
import { sugestaoCronometro } from '../../src/lib/pm/cronometroAuto'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

ok(sugestaoCronometro('em_producao', 'a', null) === 'iniciar', 'em produção sem cronômetro → sugere iniciar')
ok(sugestaoCronometro('em_producao', 'a', 'b') === 'iniciar', 'em produção com outro job aberto → sugere iniciar (o anterior para)')
ok(sugestaoCronometro('em_producao', 'a', 'a') === null, 'já ativo no job → não sugere')
for (const s of ['aguardando', 'em_aprovacao', 'concluida', 'publicado', 'cancelado']) ok(sugestaoCronometro(s, 'a', 'a') === 'parar', `${s} com o job ativo → sugere parar`)
ok(sugestaoCronometro('concluida', 'a', 'b') === null && sugestaoCronometro('concluida', 'a', null) === null, 'parar só se o ativo é este job')
ok(sugestaoCronometro('nao_iniciada', 'a', 'a') === null, 'não iniciada não mexe')
const fl = ler('src/components/pm/JobFluxo.tsx')
ok(/onSituacao\?\.?:/.test(fl) || /onSituacao\?:/.test(fl), 'JobFluxo avisa a nova situação')
const pa = ler('src/app/dashboard/pm/pauta/page.tsx')
ok(/<SugestaoCronometroAviso /.test(pa) && /sugestaoCronometro\(status/.test(pa), 'Pauta mostra a confirmação')
const comp = ler('src/components/pm/SugestaoCronometro.tsx')
ok(/cronometro-sugestao-sim/.test(comp) && /cronometro-sugestao-nao/.test(comp) && /pararCronometro/.test(comp), 'confirma ou dispensa; nunca age sozinho')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
