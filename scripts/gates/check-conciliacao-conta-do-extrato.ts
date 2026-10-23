/**
 * Gate de build (#3961 · jordana-code): o título conciliado fica na conta do EXTRATO.
 * fn_recompute_baixa_titulo (chamada em todo match/agrupado/rateio/desvínculo) termina gravando no título a conta do
 * lote do movimento conciliado mais recente; a pagar pelo nome (erp_pagar.conta_bancaria), a receber por id + nome.
 *   npm run gates -- conciliacao-conta-do-extrato
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(__dirname, '../../supabase/migrations')
const arq = readdirSync(dir).filter(f => f.endsWith('_conciliacao_conta_do_extrato_no_titulo.sql'))
ok(arq.length === 1, 'migration da conta do extrato no título existe (uma só)')
const sql = arq.length ? readFileSync(join(dir, arq[0]), 'utf8') : ''
const so = (ini: string) => { const i = sql.indexOf(ini); return i < 0 ? '' : sql.slice(i, sql.indexOf('END $function$', i)) }

const conta = so('CREATE OR REPLACE FUNCTION public.fn_titulo_conta_pela_conciliacao')
ok(conta.length > 0, 'fn_titulo_conta_pela_conciliacao criada')
ok(/m\.status = 'conciliado'/.test(conta), 'só movimento conciliado decide a conta')
ok(/conciliacao_vinculo/.test(conta), 'conciliação agrupada (vínculo) também conta')
ok(/bc\.company_id = m\.company_id/.test(conta) && /bc\.company_id = v_company/.test(conta), 'conta do extrato tem de ser da mesma empresa do título')
ok(/ORDER BY m\.data_transacao DESC/.test(conta), 'mais de um movimento → vale o mais recente')
ok(/SET conta_bancaria_id = v_conta, conta_bancaria = v_nome/.test(conta), 'a receber: id e nome da conta')
ok(/UPDATE public\.erp_pagar t\s+SET conta_bancaria = v_nome/.test(conta), 'a pagar: nome da conta (como o saldo por conta lê)')
ok(/IS NOT DISTINCT FROM v_nome\)\s+THEN\s+RETURN/.test(conta), 'já na conta do extrato → não grava nada')
ok(/'CONTA_PELA_CONCILIACAO'/.test(conta) && /pela conciliação/.test(conta), 'troca registrada no histórico: "Conta alterada de X para Y pela conciliação"')
ok(/AND v_outra THEN/.test(conta) && /'CONCILIACAO_CONTA_DIVERGENTE'/.test(conta), 'baixa em outra conta → não troca sozinho, deixa aviso para confirmar')
ok(/WHERE NOT EXISTS \(SELECT 1 FROM public\.erp_lancamento_log g/.test(conta), 'aviso de conta divergente não se repete a cada recompute')
ok(!/SECURITY DEFINER/.test(conta), 'função auxiliar não é SECURITY DEFINER (roda dentro da recompute)')
ok(/REVOKE ALL ON FUNCTION public\.fn_titulo_conta_pela_conciliacao\(text, uuid\) FROM PUBLIC, anon, authenticated/.test(sql), 'auxiliar fechada para anon/authenticated')

const modal = readFileSync(join(__dirname, '../../src/components/financeiro/HistoricoLancamentoModal.tsx'), 'utf8')
ok(/CONTA_PELA_CONCILIACAO:/.test(modal) && /CONCILIACAO_CONTA_DIVERGENTE:/.test(modal), 'histórico do título mostra os dois eventos com rótulo')
ok(/alt\.motivo/.test(modal), 'histórico do título mostra o motivo')

const rec = so('CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo')
ok(/fn_receber_conciliacao_sync/.test(rec) && /fn_pagar_conciliacao_sync/.test(rec), 'recompute continua sincronizando as baixas')
ok(/Sem acesso a esta empresa/.test(rec), 'recompute mantém a guarda de empresa')
ok(rec.indexOf('fn_titulo_conta_pela_conciliacao') > rec.indexOf('fn_pagar_conciliacao_sync'), 'conta gravada depois das baixas')
ok(!/^\s*(UPDATE|DELETE)\b/im.test(sql.replace(conta, '')), 'nenhuma correção em massa do histórico nesta migration')

if (falhas) { console.error(`\n[check-conciliacao-conta-do-extrato] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-conciliacao-conta-do-extrato] conciliação grava a conta do extrato no título.')
