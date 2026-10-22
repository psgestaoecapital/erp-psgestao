// Gate (jordana-code · caixa 7f5305cb) — município por nome + UF tolera apóstrofo, hífen e sinônimo oficial.
// Trava estática (sem rede): a regra única fn_municipio_por_nome_uf compara pela chave só-letras-e-números e cai na
// tabela de sinônimos; o gatilho do cadastro usa essa mesma função (não reimplementa a normalização).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_municipio_nome_chave_sinonimos.sql'))
ok(arq.length === 1, 'existe a migration *_municipio_nome_chave_sinonimos.sql')
if (arq.length === 1) {
  const sql = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
  ok(sql.includes("'[^a-z0-9]', '', 'g'"), 'chave do nome: tira tudo que não é letra/número (apóstrofo, hífen, espaço)')
  ok(/fn_municipio_nome_chave[\s\S]*IMMUTABLE/.test(sql), 'fn_municipio_nome_chave é IMMUTABLE (vai no índice de expressão)')
  ok(/CREATE INDEX[^;]*erp_gov_nfse_municipios \(uf, public\.fn_municipio_nome_chave\(nome_municipio\)\)/.test(sql), 'índice (uf, chave) na tabela oficial — sem função por linha na busca')
  ok(/CREATE TABLE IF NOT EXISTS public\.erp_gov_municipio_sinonimo/.test(sql) && /erp_gov_municipio_sinonimo ENABLE ROW LEVEL SECURITY/.test(sql), 'tabela de sinônimos com RLS')
  ok(/REVOKE ALL ON TABLE public\.erp_gov_municipio_sinonimo FROM PUBLIC, anon/.test(sql), 'sinônimos: REVOKE anon')
  ok(/'Mogi Mirim',\s*'3530805'/.test(sql), 'sinônimo do caso real: Mogi Mirim → Moji Mirim (3530805)')
  ok(/FROM public\.erp_gov_municipio_sinonimo s/.test(sql), 'fn_municipio_por_nome_uf cai nos sinônimos quando a chave não casa')
  const gatilho = sql.slice(sql.indexOf('FUNCTION public.fn_clientes_ibge_auto()'))
  ok(gatilho.includes('public.fn_municipio_por_nome_uf(NEW.cidade, v_uf)'), 'gatilho do cadastro usa a regra única (fn_municipio_por_nome_uf)')
  ok(/codigo_ibge_municipio\), ''\) <> ''[\s\S]*RETURN NEW/.test(gatilho), 'gatilho continua só preenchendo IBGE vazio')
}

if (falhas) { console.error(`\ncheck-municipio-grafia: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-municipio-grafia: ok')
