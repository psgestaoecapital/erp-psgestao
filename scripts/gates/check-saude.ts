// Gate (CEO 05/10 · /api/saude): regra de saúde + travas da rota (sem segredo, sem cache, timeout 5 s). Sem rede.
import { readFileSync } from 'node:fs'
import { avaliarSaude, TIMEOUT_SAUDE_MS } from '../../src/lib/saude'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

ok(avaliarSaude(200, 40).status === 200 && (avaliarSaude(200, 40).corpo as { db_ms: number }).db_ms === 40, '200 do banco → 200 {ok:true, db_ms}')
ok(avaliarSaude(401, 40).status === 200, '401 da RLS ainda prova que o banco responde')
ok(avaliarSaude(522, 40).status === 503 && avaliarSaude(500, 1).status === 503, '5xx do banco → 503')
ok(avaliarSaude(null, 5000).status === 503, 'sem resposta (timeout/erro de rede) → 503')
ok(avaliarSaude(200, TIMEOUT_SAUDE_MS + 1).status === 503, 'resposta acima do prazo → 503')
ok(JSON.stringify(avaliarSaude(522, 1).corpo) === '{"ok":false}', '503 não traz detalhe')

const rota = readFileSync('src/app/api/saude/route.ts', 'utf8')
ok(rota.includes("dynamic = 'force-dynamic'") && rota.includes('no-store'), 'cache desligado')
ok(rota.includes('AbortSignal.timeout(TIMEOUT_SAUDE_MS)') && TIMEOUT_SAUDE_MS === 5000, 'timeout de 5 s')
ok(!/SERVICE_ROLE|supabaseAdmin/.test(rota), 'nunca usa service_role')
ok(!/anon[^\n]*NextResponse|json\([^)]*anon/.test(rota), 'a resposta não carrega chave')

if (falhas) { console.error(`\n${falhas} falha(s) em check-saude`); process.exit(1) }
console.log('check-saude: OK')
