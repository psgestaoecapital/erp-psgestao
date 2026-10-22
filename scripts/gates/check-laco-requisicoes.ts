// Gate (P1 17/10) — laço de requisições (12–16 mil/h): useCompanyIds roda em cada "?" e refazia 4–5 pedidos por instância.
//  (1) disjuntor: até o limite passa, o excedente é cortado, janela vencida libera, chaves independentes, só leitura conta;
//  (2) useCompanyIds: carga ÚNICA compartilhada (dedupe + validade curta, sem getUser por instância, falha não fica em cache);
//  (3) supabase.ts: o fetch do cliente consulta o disjuntor e devolve 429 local.
import { readFileSync } from 'node:fs'
import { chaveDeLeitura, criarDisjuntor, DISJUNTOR_LIMITE } from '../../src/lib/disjuntorRequisicoes'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const U = 'https://x.supabase.co'

const kGet = chaveDeLeitura('GET', `${U}/rest/v1/users?select=role`)
ok(kGet === 'GET /rest/v1/users?select=role', 'GET /rest/v1 vira chave')
ok(chaveDeLeitura('GET', `${U}/auth/v1/user`) === 'GET /auth/v1/user', 'GET /auth/v1/user vira chave')
ok(chaveDeLeitura('POST', `${U}/rest/v1/rpc/fn_x`) === null && chaveDeLeitura('GET', `${U}/auth/v1/token`) === null
  && chaveDeLeitura('PATCH', `${U}/rest/v1/users`) === null, 'escrita, RPC POST e refresh de token nunca contam')

const p = criarDisjuntor(DISJUNTOR_LIMITE, 60_000)
const t0 = 1_000_000
let passou = 0
for (let i = 0; i < DISJUNTOR_LIMITE + 50; i++) if (p(kGet!, t0 + i)) passou++
ok(passou === DISJUNTOR_LIMITE, `laço: só ${DISJUNTOR_LIMITE} de ${DISJUNTOR_LIMITE + 50} pedidos idênticos passam (passaram ${passou})`)
ok(p('GET /rest/v1/companies?select=*', t0 + 10), 'outra URL não é afetada')
ok(p(kGet!, t0 + 61_000 + DISJUNTOR_LIMITE), 'janela vencida libera de novo')
// uso normal: 40 pedidos distintos espalhados nunca disparam
const q = criarDisjuntor(DISJUNTOR_LIMITE, 60_000)
let cortou = 0
for (let i = 0; i < 40; i++) if (!q(`GET /rest/v1/t${i}`, t0)) cortou++
ok(cortou === 0, 'uso normal não é cortado')

const hook = readFileSync('src/lib/useCompanyIds.ts', 'utf8')
ok(/let cargaAtual/.test(hook) && /return cargaAtual\.p/.test(hook) && /VALIDADE_MS/.test(hook), 'useCompanyIds: carga compartilhada com validade')
ok(!/auth\.getUser\(\)/.test(hook) && /getUsuarioId\(\)/.test(hook), 'useCompanyIds: sessão local (sem getUser por instância)')
ok(/p\.catch\(\(\) => \{ if \(cargaAtual === registro\) cargaAtual = null/.test(hook), 'falha da carga não fica em cache')
ok((hook.match(/from\("company_groups"\)/g) ?? []).length === 1, 'company_groups consultado em um único ponto')

const sb = readFileSync('src/lib/supabase.ts', 'utf8')
ok(/permitirLeitura\(chave\)/.test(sb) && /status: 429/.test(sb) && /catch \{ \/\* o disjuntor nunca quebra o fetch \*\/ \}/.test(sb), 'supabase.ts: fetch consulta o disjuntor e nunca quebra por ele')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-laco-requisicoes: OK')
