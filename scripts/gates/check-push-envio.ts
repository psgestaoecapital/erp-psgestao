// Gate (chamado #120 · push custo zero): o envio é por EVENTO (gatilho + pg_net), com as travas aprovadas, sem cron.
// Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const sql = readFileSync('supabase/migrations/20261017030030_push_envio_gatilho.sql', 'utf8')
const fn = readFileSync('supabase/functions/push-enviar/index.ts', 'utf8')

ok(/AFTER INSERT ON public\.erp_notificacao_usuario/.test(sql) && /net\.http_post/.test(sql), 'gatilho no INSERT do aviso chama a função via pg_net')
ok(!/cron\.schedule/i.test(sql), 'sem cron/polling')
ok(/erp_push_preferencia[\s\S]*p\.ativo/.test(sql) && /erp_push_assinatura[\s\S]*a\.ativo/.test(sql), 'opt-in por usuário e tipo + aparelho ativo')
ok(/interval '10 minutes'/.test(sql), 'agrupa: 1 push por origem a cada 10 min')
ok(/v_teto\s+constant int := 500/.test(sql) && /teto diario/.test(sql), 'teto diário por empresa com alerta')
ok(/EXCEPTION WHEN OTHERS/.test(sql), 'falha de push nunca impede o aviso do sininho')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON public\.erp_push_grupo FROM PUBLIC, anon, authenticated/.test(sql), 'tabelas novas com RLS e REVOKE')
ok(/Bearer \$\{SERVICE_KEY\}/.test(fn), 'função só aceita chamada do banco (service_role)')
ok(/statusCode/.test(fn) && /404 \|\| code === 410/.test(fn) && /\.delete\(\)/.test(fn), 'apaga assinatura expirada (404/410)')
ok(/VAPID_PRIVATE_KEY/.test(fn) && !/BEGIN PRIVATE/.test(fn), 'chave VAPID só como segredo da função')
ok(/startsWith\("\/"\)/.test(fn), 'link só do próprio app')
const ssrf = readFileSync('supabase/migrations/20261017050030_push_endpoint_somente_servicos_de_push.sql', 'utf8')
ok(/CHECK \(endpoint ~\* '\^https:/.test(ssrf) && /fcm\\\.googleapis\\\.com/.test(ssrf) && /push\\\.apple\\\.com/.test(ssrf), 'endpoint só https + hosts de serviço de push (CHECK)')
ok(/endpointPermitido\(s\.endpoint\)/.test(fn), 'edge recusa endpoint fora dos serviços de push (SSRF)')
if (falhas) process.exit(1)
