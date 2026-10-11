// Gate · PM-T (4a) — anti-esquecimento: inatividade de 30 min pergunta, cronômetro esquecido é cortado no último sinal. Sem rede.
import { readFileSync } from 'node:fs'
import { inativo, esquecido, fimDoCorte, INATIVIDADE_MIN } from '../../src/lib/pm/cronometroInatividade'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

const t0 = Date.UTC(2026, 9, 7, 12, 0, 0)
ok(INATIVIDADE_MIN === 30 && !inativo(t0, t0 + 29 * 60_000) && inativo(t0, t0 + 30 * 60_000), 'inativo a partir de 30 min sem atividade')
ok(!esquecido(new Date(t0).toISOString(), t0 + 11 * 3_600_000) && esquecido(new Date(t0).toISOString(), t0 + 12 * 3_600_000), 'esquecido a partir de 12 h aberto')
ok(fimDoCorte(new Date(t0).toISOString(), t0 + 600_000).getTime() === t0 + 600_000, 'corte no último sinal de vida')
ok(fimDoCorte(new Date(t0).toISOString(), t0 - 1000).getTime() === t0, 'corte nunca antes do início')
const g = ler('src/components/pm/CronometroGlobal.tsx')
ok(/cronometro-inatividade-continuar/.test(g) && /cronometro-inatividade-cortar/.test(g) && /pararCronometro\(aberto, fimDoCorte/.test(g), 'pergunta; a pessoa continua ou corta (nada age sozinho)')
ok(/pararCronometro\(aberto: CronometroAberto, fimEm\?: Date\)/.test(ler('src/lib/pm/cronometroGlobal.ts')), 'parar aceita fim explícito (corte)')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
