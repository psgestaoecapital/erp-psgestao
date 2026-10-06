/**
 * Gate de build · Produtividade F2: kg por homem-hora (só leitura, aditivo, RD-38: numerador = producao_frigorifico).
 *   tsx scripts/gates/check-prod-indicadores.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const mig = readFileSync('supabase/migrations/20261006120010_prod_indicadores_fase2.sql', 'utf8')
ok(/CREATE TABLE IF NOT EXISTS public\.prod_indicador_meta/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig), 'tabela de metas nova com RLS')
ok(/company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(mig), 'policy por empresa')
ok(/REVOKE ALL ON public\.prod_indicador_meta FROM anon/.test(mig), 'REVOKE anon na tabela')
ok(/REVOKE ALL ON FUNCTION public\.fn_prod_indicadores\(uuid, date, date\) FROM PUBLIC, anon/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_prod_indicador_meta_salvar/.test(mig), 'REVOKE anon nas funções')
ok((mig.match(/fn_compliance_assert\(p_company_id\)/g) || []).length >= 2, 'as duas funções têm guarda de empresa')
ok(/producao_frigorifico/.test(mig) && !/FROM public\.desossa_rendimento/.test(mig), 'numerador = producao_frigorifico, nunca desossa_rendimento (linhas explodidas)')
ok(/pt\.pessoas >= 5/.test(mig) && /motivo_sem_dado/.test(mig), 'dia que não casa vira "sem dado", nunca zero inventado')
ok(!/UPDATE public\.(?!prod_indicador_meta)/.test(mig) && !/DELETE FROM public\.(?!prod_indicador_meta)/.test(mig), 'nenhum dado de outra tabela é alterado/apagado')

const tela = readFileSync('src/app/dashboard/produtividade/indicadores/page.tsx', 'utf8')
ok(/fn_prod_indicadores/.test(tela) && /fn_prod_indicador_meta_salvar/.test(tela), 'tela usa as duas funções')
ok(/window\.print\(\)/.test(tela), 'tela exporta PDF por impressão')

if (falhas > 0) { console.error(`\n[check-prod-indicadores] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-prod-indicadores] indicadores de produtividade conferidos.')
