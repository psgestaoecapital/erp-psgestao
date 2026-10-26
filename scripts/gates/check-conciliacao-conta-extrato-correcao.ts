/**
 * Gate de build (#3961 · jordana-code): correção dos casos antigos do grupo C (título conciliado em outra conta).
 * Só Prigol, Troian e Gean (PS Gestão FORA); backup de título e baixas ANTES de mudar; só a conta do título muda;
 * cada título ganha a linha no histórico; grupos A, B e dúvida ficam fora.
 *   npm run gates -- conciliacao-conta-extrato-correcao
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(__dirname, '../../supabase/migrations')
const arq = readdirSync(dir).filter(f => f.endsWith('_conciliacao_conta_extrato_correcao_grupo_c.sql'))
ok(arq.length === 1, 'migration da correção do grupo C existe (uma só)')
const sql = arq.length ? readFileSync(join(dir, arq[0]), 'utf8') : ''
const corpo = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')

const empresas = [...corpo.matchAll(/\('([0-9a-f-]{36})'::uuid\)/g)].map(m => m[1])
ok(empresas.length === 3 && ['36b69d77', 'd577602d', 'a462e13f'].every(p => empresas.some(e => e.startsWith(p))),
  'só as 3 empresas aprovadas (Prigol, Troian, Gean)')

ok(/ENABLE ROW LEVEL SECURITY/.test(corpo) && /REVOKE ALL ON TABLE public\.erp_conciliacao_conta_bkp_3961 FROM PUBLIC, anon, authenticated/.test(corpo),
  'tabela de backup com RLS e fechada para anon/authenticated')
const iBkp = corpo.indexOf('INSERT INTO public.erp_conciliacao_conta_bkp_3961')
const iUpd = corpo.search(/UPDATE public\.erp_(receber|pagar) t/)
ok(iBkp > 0 && iUpd > iBkp, 'backup (título + baixas) gravado antes de qualquer UPDATE')
ok(/erp_receber_baixa b WHERE b\.receber_id = c\.lid/.test(corpo) && /erp_pagar_baixa b WHERE b\.pagar_id = c\.lid/.test(corpo),
  'backup inclui as baixas de cada título')

ok(/m\.status = 'conciliado'/.test(corpo), 'só movimento conciliado entra')
ok(/arquivo\.ofx16-10/.test(corpo), 'grupo A (OFX da Proplay na Prigol, #2914) fica fora')
ok(/AND NOT c\.baixa_outro_extrato/.test(corpo), 'baixa ligada a extrato de outra conta (dúvida) fica fora')
ok(/WHEN c\.tn = c\.ln THEN false/.test(corpo) && /ELSE false/.test(corpo), 'nome já certo, grupo B e dúvida não mudam')

ok(/UPDATE public\.erp_receber t\s+SET conta_bancaria_id = c\.conta_lote, conta_bancaria = c\.nome_lote, updated_at = now\(\)\s+FROM _c3961 c/.test(corpo),
  'a receber: só a conta (id + nome)')
ok(/UPDATE public\.erp_pagar t\s+SET conta_bancaria = c\.nome_lote, updated_at = now\(\)\s+FROM _c3961 c/.test(corpo), 'a pagar: só a conta (nome)')
ok(!/SET[^;]*\b(valor|status|data_pagamento|valor_pago)\s*=/i.test(corpo), 'valor, status e datas do título não mudam')
ok(/'CONTA_PELA_CONCILIACAO'/.test(corpo) && /chamado #3961/.test(corpo), 'cada título corrigido ganha a linha no histórico')
ok(/754d58c6-bee2-43b4-955b-6f6aa416c625' AND r\.origem_baixa = 'permuta'/.test(corpo), 'origem "permuta" do título de 25 mil só muda se ainda for permuta')
ok(!/\b(DELETE|TRUNCATE|DROP)\b/i.test(corpo), 'sem DELETE/TRUNCATE/DROP')

if (falhas) { console.error(`\n[check-conciliacao-conta-extrato-correcao] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-conciliacao-conta-extrato-correcao] correção do grupo C conferida.')
