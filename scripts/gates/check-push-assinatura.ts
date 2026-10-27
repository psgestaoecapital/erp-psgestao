// Gate (chamado #120 · push custo zero): tabelas de assinatura/preferência de Web Push com RLS por usuário,
// sem acesso do anon e sem o cliente reescrever chave/endpoint. Estático, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const mig = readFileSync('supabase/migrations/20261016220130_push_assinatura.sql', 'utf8')

for (const t of ['erp_push_assinatura', 'erp_push_preferencia']) {
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(mig), `${t}: RLS ligada`)
  ok(new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated`).test(mig), `${t}: sem acesso do anon`)
}
ok(/user_id = auth\.uid\(\)/.test(mig) && /user_companies uc/.test(mig), 'cada pessoa só mexe no próprio aparelho, em empresa que acessa')
ok(/GRANT UPDATE \(ativo, user_agent\) ON public\.erp_push_assinatura/.test(mig), 'cliente não reescreve endpoint/chaves')
ok(/UNIQUE \(endpoint\)/.test(mig), 'um endpoint por aparelho')
ok(!/pg_cron|cron\.schedule/.test(mig), 'sem robô por minuto (disparo por evento)')
if (falhas) process.exit(1)
