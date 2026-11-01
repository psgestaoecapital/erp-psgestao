/**
 * Gate (#2936 etapa 5): lembretes automáticos de assinatura eletrônica de contrato.
 * Travas que não podem regredir sem ninguém ver:
 *  - a rotina é só do cron/service_role (nunca anon/authenticated);
 *  - no máximo 3 lembretes, de 2 em 2 dias, e nunca para quem está assinando agora;
 *  - o lembrete leva um link novo, e a troca do token é desfeita se o e-mail não sair;
 *  - nome da empresa/contrato escapados no HTML do e-mail;
 *  - envio vencido vira 'expirado';
 *  - o hash do link continua fora do SELECT da empresa (só o contador é liberado).
 */
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => /^\d{14}_contrato_assinatura_lembretes\.sql$/.test(f))
ok(!!arq, 'migration dos lembretes existe')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8').replace(/^\s*--.*$/gm, '') : ''
const fn = sql.slice(sql.indexOf('FUNCTION public.fn_contrato_assinatura_lembretes('), sql.indexOf('REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_lembretes'))

ok(/REVOKE EXECUTE ON FUNCTION public\.fn_contrato_assinatura_lembretes\(int\) FROM anon, public, authenticated/.test(sql), 'rotina sem EXECUTE para anon/public/authenticated')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_contrato_assinatura_lembretes\(int\) TO service_role/.test(sql), 'rotina executável pelo service_role')
ok(!/GRANT EXECUTE ON FUNCTION public\.fn_contrato_assinatura_lembretes\(int\) TO (anon|authenticated)/.test(sql), 'nenhum GRANT da rotina para anon/authenticated')
ok(/lembretes_enviados < 3/.test(fn), 'no máximo 3 lembretes')
ok(/COALESCE\(s\.ultimo_lembrete_em, e\.criado_em\) <= now\(\) - interval '2 days'/.test(fn), 'intervalo de 2 dias desde o envio/último lembrete')
ok(/s\.codigo_expira_em IS NULL OR s\.codigo_expira_em < now\(\)/.test(fn) && /s\.visualizado_em < now\(\) - interval '1 hour'/.test(fn), 'quem está assinando agora não recebe')
ok(/e\.expira_em >= now\(\) \+ interval '12 hours'/.test(fn), 'envio prestes a vencer não recebe lembrete')
ok(/s\.status IN \('pendente', 'visualizado'\)/.test(fn) && /e\.status = 'aguardando'/.test(fn), 'só quem ainda não assinou, de envio aguardando')
ok(/RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lembrete_nao_enviado'/.test(fn) && /EXCEPTION WHEN OTHERS THEN/.test(fn),
  'e-mail que não sai desfaz a troca do token (o link antigo segue valendo)')
ok(fn.indexOf('token_hash = public.fn_contrato_assin__sha256(v_token)') > -1
  && fn.indexOf('token_hash = public.fn_contrato_assin__sha256(v_token)') < fn.indexOf("RAISE EXCEPTION USING ERRCODE = 'P0001'"),
  'troca do token fica dentro do bloco desfeito pela falha do e-mail')
for (const campo of ['v_r.empresa', 'split_part(v_r.nome', 'COALESCE(v_r.contrato_nome']) {
  ok(fn.includes(`public.fn_contrato_assin__html(${campo}`), `${campo} escapado no HTML do e-mail`)
}
ok(/UPDATE public\.erp_contrato_assinatura_envio SET status = 'expirado'\s+WHERE status = 'aguardando' AND expira_em < now\(\)/.test(fn), 'envio vencido vira expirado')
ok(/'link', v_link/.test(fn) && /'\/sign\/contrato\/' \|\| v_token/.test(fn), 'lembrete leva o link novo')
ok(/'idempotency_key', 'contrato-assin-lembrete-' \|\| v_r\.id::text \|\| '-' \|\| v_n/.test(fn), 'um e-mail por lembrete (idempotente)')
ok(/GRANT SELECT \(lembretes_enviados, ultimo_lembrete_em\) ON public\.erp_contrato_assinatura_signatario TO authenticated/.test(sql)
  && !/GRANT SELECT[^;]*token_hash/.test(sql) && !/GRANT SELECT ON public\.erp_contrato_assinatura_signatario/.test(sql),
  'empresa vê só o contador; hash do link continua fora')
ok(/cron\.schedule\('contrato-assinatura-lembretes', '0 12 \* \* \*'/.test(sql), 'cron diário às 09:00 BRT')

if (falhas) { console.error(`check-contrato-assinatura-lembretes: ${falhas} falha(s)`); process.exit(1) }
console.log('check-contrato-assinatura-lembretes: ok')
