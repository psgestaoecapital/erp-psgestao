// Gate (#587 · Frioeste · CEO 04/10): dia com menos pausas do que a jornada pedia não sai "conforme" (RD-51) nem "desvio"
// por estimativa (RD-38); o almoço sai da exposição quando a empresa liga almoco_interrompe_exposicao. Sem CPF. Sem rede.
import { readFileSync } from 'node:fs'
import { apurarDiaTermica } from '../../src/lib/ponto/apuracaoTermica'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const frioeste = { gatilho_min: 100, pausa_min: 20, almoco_interrompe_exposicao: true }
const semParam = { gatilho_min: 100, pausa_min: 20 }
// casos reais (matrícula 1016): 16/09 jornada 05:28–15:27, almoço 74 min, pausas 22+20+23; 30/09 07:19–17:23, almoço 60, pausas 26+20+22+20
const d1609 = { jornadaMin: 599, almocoMin: 74, pausasMin: [22, 20, 23] }
const d3009 = { jornadaMin: 604, almocoMin: 60, pausasMin: [26, 20, 22, 20] }

const a = apurarDiaTermica(d1609, frioeste)
ok(a.status === 'pendente_confirmacao' && a.motivo === 'pausas_faltantes' && a.devido === 4 && a.realizado === 3, '16/09: 3 de 4 → pendente, motivo pausas_faltantes (antes: conforme 3 de 5)')
const b = apurarDiaTermica(d3009, frioeste)
ok(b.status === 'conforme' && b.devido === 4 && b.realizado === 4, '30/09: 4 de 4 descontado o almoço → conforme (antes: 4 de 5 e conforme)')
const c = apurarDiaTermica(d1609, semParam), c2 = apurarDiaTermica(d3009, semParam)
ok(c.status === 'conforme' && c.devido === 5 && c2.status === 'conforme' && c2.devido === 5, 'empresa SEM o parâmetro: resultado idêntico ao de hoje (5 devidas, conforme)')
ok(apurarDiaTermica({ ...d1609, pausasMin: [22, 19, 23] }, frioeste).status === 'desvio', 'pausa abaixo do mínimo segue desvio')
ok(apurarDiaTermica({ ...d1609, pausasMin: [] }, frioeste).motivo === 'sem_registro_pausa', 'sem nenhuma pausa segue sem_registro_pausa')

const mig = readFileSync('supabase/migrations/20261005000000_nr36_almoco_pausas_faltantes.sql', 'utf8')
ok(/almoco_interrompe_exposicao'\)::boolean, false\)/.test(mig), 'lê o parâmetro existente, sem default novo (ausente = false)')
ok(/WHEN v_almoco AND v_realizado < v_devido THEN 'pendente_confirmacao'/.test(mig) && /'pausas_faltantes'/.test(mig), 'pausas_faltantes só com o parâmetro ligado')
ok(/v_jornada_min - v_almoco_min - COALESCE\(v_pausas_min,0\)/.test(mig), 'exposição desconta o almoço')
ok(!/\b(INSERT INTO|DELETE FROM)\b\s+public\.(?!nr36_pausa_apurada)|\bUPDATE public\./.test(mig), 'a migration não reapura nem altera dado (reapuração é passo à parte, com backup)')

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/pausas_faltantes[\s\S]{0,80}Fez menos pausas do que a jornada pedia/.test(tela), 'tela mostra o motivo em linguagem simples')

if (falhas) { console.error(`\n${falhas} falha(s) (#587 almoço/pausas faltantes)`); process.exit(1) }
console.log('\nNR-36 almoço + pausas faltantes (#587): ok')
