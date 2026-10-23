/**
 * Gate de build · #3866 (Jordana · Troian): a linha "Sem conta" da composição do saldo só soma o liquidado a partir do
 * início do controle (menor data de saldo inicial das contas que somam no saldo). O histórico importado antes disso não
 * vira pendência; a tela mostra a quantidade, o "?" (RD-95) e o link para a lista dos sem conta.
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

// a definição vigente da função é a da migration mais nova que a recria
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const ultima = migs.filter((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')
  .includes('CREATE OR REPLACE FUNCTION public.fn_saldo_gerencial_contas')).pop() ?? ''
const sql = ultima ? readFileSync(`supabase/migrations/${ultima}`, 'utf8') : ''
const sem = sql.slice(sql.indexOf('sem AS ('), sql.indexOf('calc AS ('))
ok(/corte AS \(SELECT vid AS cid, \(SELECT MIN\(c\.dsi\) FROM contas c WHERE c\.cid = vid AND c\.soma\) AS dc/.test(sql),
  `${ultima}: início do controle = menor data de saldo inicial das contas que somam`)
ok((sem.match(/l\.d >= COALESCE\(ct\.dc,'1900-01-01'::date\)/g) ?? []).length === 4,
  'as 4 somas do bloco "Sem conta" (recebido/pago, valor/quantidade) cortam pela data de início')
ok(sql.includes("'Sem conta'::text, NULL::text, false, 0::numeric, s.dc,"), 'a linha "Sem conta" devolve a data de corte')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_saldo_gerencial_contas\(uuid\[\]\) TO service_role;/.test(sql)
  && /REVOKE ALL ON FUNCTION public\.fn_saldo_gerencial_contas\(uuid\[\]\) FROM PUBLIC, anon, authenticated;/.test(sql),
  'grants iguais aos de antes (só service_role)')

const tela = readFileSync('src/components/ge/HeroSaldoBancario.tsx', 'utf8')
ok(tela.includes('data-testid="saldo-composicao-sem-conta"'), 'linha "Sem conta" da composição tem data-testid')
ok(/<AjudaCampo chave="ge\.saldo\.sem_conta"/.test(tela), 'linha "Sem conta" tem o "?" (RD-95)')
ok(tela.includes("linkSemConta('receber'") && tela.includes("linkSemConta('pagar'"), 'links para as listas de recebidas e pagas sem conta')
ok(migs.some((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').includes("'ge.saldo.sem_conta'")),
  'chave ge.saldo.sem_conta cadastrada em erp_ajuda_campo por migration')

const lista = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
ok(lista.includes("qs.get('sem_conta') === '1'") && lista.includes("qs.get('desde')"), 'a listagem abre filtrada pelo link (sem conta, desde)')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do corte da linha "Sem conta" (#3866)`); process.exit(1) }
console.log('✓ #3866: "Sem conta" só desde o início do controle, com quantidade, "?" e link')
