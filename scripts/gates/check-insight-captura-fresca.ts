// Gate (Eng. Chefe 23/10, msg 6fd7cc9d item 1) — o insight-auditor não julga FOTO VELHA da rota pedida.
// fn_auditor_disparar fotografa (Playwright) e analisa (insight-auditor) em paralelo; a análise lia o print anterior
// (19/10, "Carregando menu…") e reprovava a tela por engano. Regra única em _shared/capturaFresca.ts. Sem rede.
import { readFileSync } from 'node:fs'
import { capturaFresca, FOLGA_CAPTURA_MS, ESPERA_CAPTURA_MS } from '../../supabase/functions/_shared/capturaFresca'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regra (comportamento) — caso real da prova: pedido 23/10 19:30:00, print velho 19/10, print novo 19:30:09 ──
const pedido = Date.parse('2026-10-23T19:30:00Z')
ok(!capturaFresca('2026-10-19T14:11:07.409Z', pedido), 'regra: print de 19/10 NÃO vale para o pedido de 23/10 19:30')
ok(capturaFresca('2026-10-23T19:30:09.933Z', pedido), 'regra: print capturado depois do pedido vale')
ok(capturaFresca(new Date(pedido - FOLGA_CAPTURA_MS + 1000).toISOString(), pedido), 'regra: captura dentro da folga (antes do pedido) vale')
ok(!capturaFresca(new Date(pedido - FOLGA_CAPTURA_MS - 1000).toISOString(), pedido), 'regra: captura fora da folga não vale')
ok(!capturaFresca(null, pedido) && !capturaFresca(undefined, pedido) && !capturaFresca('', pedido) && !capturaFresca('lixo', pedido),
  'regra: sem data / data inválida → não vale (fail-closed)')
ok(ESPERA_CAPTURA_MS >= 60_000 && ESPERA_CAPTURA_MS <= 120_000, 'regra: espera cabe no tempo do Playwright (90 s) e da edge function')

// ── edge function usa a regra ───────────────────────────────────────────────────────────────────────────────
const fn = readFileSync('supabase/functions/insight-auditor/index.ts', 'utf8')
ok(/import \{ capturaFresca, ESPERA_CAPTURA_MS, INTERVALO_CAPTURA_MS \} from "\.\.\/_shared\/capturaFresca\.ts"/.test(fn),
  'insight-auditor importa a regra única')
ok(/const inicioPedidoMs = Date\.now\(\)/.test(fn) && /if \(rotaEspecifica && !aceitarCapturaAntiga/.test(fn),
  'insight-auditor: rota pedida espera a captura da rodada (salvo aceitar_captura_antiga)')
ok(/sem_captura_nova: true/.test(fn) && /screens = \(screens \|\| \[\]\)\.filter\(fresca\)/.test(fn),
  'insight-auditor: sem foto nova não chama a IA; com foto nova analisa só ela')

if (falhas) { console.error(`\n${falhas} falha(s) — check-insight-captura-fresca`); process.exit(1) }
console.log('\ncheck-insight-captura-fresca OK')
