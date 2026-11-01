// Gate — card "Saúde dos Codes" na aba Codes (Eng. Chefe 11/10): semáforo por Code, lê fn_codes_saude(). Sem rede.
import { readFileSync } from 'node:fs'
import { ordenarSaude, semaforoCode, statusSaude, type SaudeCode } from '../../src/lib/dev/saudeCodes'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const c = (code: string, status: string): SaudeCode => ({ code, status, lease_ativa: false, tarefas_recentes: 0, mais_antiga_recente_min: null, backlog_antigo: 0 })

ok(semaforoCode(c('a', 'trabalhando')) === 'verde' && semaforoCode(c('a', 'na fila')) === 'verde', 'trabalhando / na fila → verde')
ok(semaforoCode(c('a', 'ocioso')) === 'amarelo', 'ocioso → amarelo')
ok(semaforoCode(c('a', 'TRAVADO')) === 'vermelho', 'TRAVADO → vermelho')
ok(semaforoCode(c('a', 'qualquer-coisa')) === 'vermelho', 'status desconhecido → vermelho')
ok(ordenarSaude([c('b', 'trabalhando'), c('a', 'TRAVADO'), c('c', 'ocioso')]).map((x) => x.code).join() === 'a,c,b', 'vermelho primeiro, depois amarelo, depois verde')

const card = readFileSync('src/components/dev/SaudeCodes.tsx', 'utf8')
ok(card.includes("rpc('fn_codes_saude')"), 'card lê a RPC fn_codes_saude')
ok(card.includes('Backlog antigo') && card.includes('aria-label="O que significa a Saúde dos Codes"'), 'mostra backlog_antigo e tem "?"')
ok(readFileSync('src/components/dev/PainelCodes.tsx', 'utf8').includes('<SaudeCodes />'), 'card montado na aba Codes')
ok(card.includes("rpc('fn_dev_esteira_dono_resumo')") && card.includes('saude-dono-esteira'), 'cartão do gilberto-esteira mostra o resumo do dono da esteira')
// RD-38: os três casos da msg 502b285e
ok(statusSaude({ renovada_min: 3, encerrou_normalmente: false, trabalho_pendente: true, plantao_min: 90 }) === 'trabalhando', 'caso 1: renovada < 12 min → trabalhando')
ok(statusSaude({ renovada_min: 1440, encerrou_normalmente: true, trabalho_pendente: true, plantao_min: 5 }) === 'na fila', 'caso 2: encerrou normalmente, plantão fresco → não é TRAVADO')
ok(statusSaude({ renovada_min: 1440, encerrou_normalmente: true, trabalho_pendente: false, plantao_min: 500 }) === 'ocioso', 'caso 2b: encerrou normalmente sem pendência → ocioso')
ok(statusSaude({ renovada_min: 1440, encerrou_normalmente: true, trabalho_pendente: true, plantao_min: 45 }) === 'TRAVADO', 'caso 3: pendente + plantão parado > 30 min → TRAVADO')
const mig = readFileSync('supabase/migrations/20261017230000_codes_saude_ultima_atividade.sql', 'utf8')
ok(mig.includes('iniciada_em') && mig.includes("interval '12 minutes'") && mig.includes("interval '30 minutes'") && !/renovada_em\s*>\s*now\(\)\s*-\s*interval '4/.test(mig), 'migration usa iniciada_em, 12 min e 30 min')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
