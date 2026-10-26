/**
 * Gate de build · #3866 (Jordana · Troian): histórico importado só para consulta, POR EMPRESA.
 * companies.data_corte_historico (NULL = sem corte). Título com vencimento antes do corte e liquidado antes dele sai do
 * saldo e do "Sem conta"; liquidado a partir do corte continua contando. Só a Troian recebe a data; as outras empresas
 * ficam idênticas (o corte não pode vir de dado de todas as empresas, como a menor data de saldo inicial).
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const TROIAN = 'd577602d-b21a-4d97-ae59-401777383c23'
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const ler = (f: string) => readFileSync(`supabase/migrations/${f}`, 'utf8')

const col = migs.find((f) => /ADD COLUMN IF NOT EXISTS data_corte_historico date;/.test(ler(f))) ?? ''
ok(!!col, 'coluna companies.data_corte_historico criada por migration (nullable, sem default)')
const sqlCol = col ? ler(col) : ''
const updates = sqlCol.match(/UPDATE public\.companies SET data_corte_historico[\s\S]*?;/g) ?? []
ok(updates.length === 1 && updates[0].includes(`WHERE id = '${TROIAN}'`) && updates[0].includes("DATE '2026-10-01'"),
  'a data de corte (01/10/2026) vai SÓ para a Troian')

// a definição vigente da função é a da migration mais nova que a recria
const ultima = migs.filter((f) => ler(f).includes('CREATE OR REPLACE FUNCTION public.fn_saldo_gerencial_contas')).pop() ?? ''
const sql = ultima ? ler(ultima) : ''
ok(/corte AS \(SELECT co\.id AS cid, co\.data_corte_historico AS dc FROM companies co/.test(sql),
  `${ultima}: o corte vem da configuração da empresa`)
ok(!/MIN\([a-z.]*dsi\)/.test(sql), 'o corte NÃO usa a menor data de saldo inicial (regra só da Troian, por configuração)')
ok((sql.match(/WHERE NOT COALESCE\(l\.venc < k\.dc AND l\.d < k\.dc, false\)/g) ?? []).length === 2,
  'recebimentos e pagamentos: sai só o vencido E liquidado antes do corte (liquidado depois continua; sem corte nada sai)')
ok(sql.includes('er.data_vencimento AS venc') && sql.includes('ep.data_vencimento AS venc'), 'o critério é o VENCIMENTO do título')
ok(/REVOKE ALL ON FUNCTION public\.fn_saldo_gerencial_contas\(uuid\[\]\) FROM PUBLIC, anon, authenticated;/.test(sql)
  && /GRANT EXECUTE ON FUNCTION public\.fn_saldo_gerencial_contas\(uuid\[\]\) TO service_role;/.test(sql),
  'grants iguais aos de antes (só service_role)')

if (falhas) { console.error(`\n${falhas} falha(s) no gate do corte do histórico importado (#3866)`); process.exit(1) }
console.log('✓ #3866: histórico importado fora do saldo e do "Sem conta" só na empresa configurada (Troian)')
