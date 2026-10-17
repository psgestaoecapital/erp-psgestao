/**
 * Gate (#2936 etapa 1): base da assinatura eletrônica de contratos — segurança e LGPD na migration.
 * A prova funcional (enviar, abrir, código, assinar, concluir, nova versão, verificar) roda em Postgres local
 * (19 verificações, 2x); aqui ficam as travas que não podem regredir sem ninguém ver.
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const sql = readFileSync('supabase/migrations/20261017070120_contrato_assinatura_eletronica_base.sql', 'utf8')
const sem = (s: string) => s.replace(/--.*$/gm, '')
const corpo = sem(sql)

ok(/ALTER TABLE public\.erp_contrato_assinatura_envio\s+ENABLE ROW LEVEL SECURITY/.test(corpo)
  && /ALTER TABLE public\.erp_contrato_assinatura_signatario ENABLE ROW LEVEL SECURITY/.test(corpo), 'RLS ligada nas duas tabelas')
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.erp_contrato_assinatura_envio, public\.erp_contrato_assinatura_signatario FROM authenticated/.test(corpo), 'sem escrita direta pela tela')
ok(/token_hash\s+text NOT NULL UNIQUE/.test(corpo) && !/\btoken\s+text\b/.test(corpo), 'link guardado só como hash')
ok(/REVOKE SELECT ON public\.erp_contrato_assinatura_signatario FROM authenticated/.test(corpo)
  && !/GRANT SELECT \([^)]*(token_hash|codigo_hash)[^)]*\)/.test(corpo), 'hash do link/código fora do SELECT da tela')
ok(/CHECK \(geolocalizacao IS NULL OR geo_consentido\)/.test(corpo), 'geolocalização só com consentimento')
ok(/codigo_tentativas >= 5/.test(corpo) && /interval '10 minutes'/.test(corpo) && /codigo_enviados >= 5/.test(corpo), 'código: validade, tentativas e reenvios limitados')
ok(/p_documento_hash IS DISTINCT FROM v_e\.documento_hash/.test(corpo), 'assina só o documento com o hash enviado')
ok(/cancelado_motivo = 'Substituído por nova versão'/.test(corpo), 'nova versão invalida o link anterior')

const doSignatario = ['fn_contrato_assinatura_abrir', 'fn_contrato_assinatura_codigo', 'fn_contrato_assinatura_assinar', 'fn_contrato_assinatura_verificar']
for (const f of doSignatario) {
  ok(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) FROM anon, public, authenticated`).test(corpo), `${f}: fora do anon/authenticated (só rota do servidor)`)
  ok(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO [^;]*(anon|authenticated)`).test(corpo), `${f}: sem GRANT ao anon/authenticated`)
}
for (const f of ['fn_contrato_assinatura_enviar', 'fn_contrato_assinatura_cancelar']) {
  ok(new RegExp(`FUNCTION public\\.${f}[\\s\\S]*?fn__guarda_empresa`).test(corpo), `${f}: guarda de empresa`)
  ok(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) FROM anon, public`).test(corpo), `${f}: sem anon`)
}
const verificar = corpo.slice(corpo.indexOf('FUNCTION public.fn_contrato_assinatura_verificar'))
const retornoVerificar = verificar.slice(0, verificar.indexOf('END $$'))
ok(!/'documento', s\.documento|assinatura_ip|geolocalizacao|visualizado_ip/.test(retornoVerificar), 'verificação pública não devolve CPF/CNPJ, IP nem geolocalização')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(fn__guarda_empresa|get_user_company_ids|is_admin))/.test(corpo) && !/DROP (TABLE|FUNCTION|VIEW)/.test(corpo), 'nenhuma função/view existente reescrita ou apagada')

if (falhas) { console.error(`\n[check-contrato-assinatura-base] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-contrato-assinatura-base] base da assinatura eletrônica conferida.')
