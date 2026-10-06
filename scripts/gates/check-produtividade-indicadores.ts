/**
 * Gate de build · Produtividade Fase 2 (Frioeste): a migration dos indicadores segue as regras (RD-38, RLS, REVOKE anon)
 * e a tela mostra "sem dado" em vez de zero inventado, com meta editável e semáforo só com meta.
 *   tsx scripts/gates/check-produtividade-indicadores.ts
 */
import { readFileSync } from 'node:fs'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const mig = readFileSync('supabase/migrations/20261006120010_prod_indicadores_fase2.sql', 'utf8')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /get_user_company_ids\(\)/.test(mig), 'tabela de meta com RLS por empresa')
ok(/REVOKE ALL ON public\.prod_indicador_meta FROM anon/.test(mig), 'tabela de meta sem acesso anon')
ok((mig.match(/fn_compliance_assert\(p_company_id\)/g) ?? []).length === 2, 'as duas funções chamam fn_compliance_assert')
ok(/REVOKE ALL ON FUNCTION public\.fn_prod_indicadores\(uuid, date, date\) FROM PUBLIC, anon/.test(mig), 'fn_prod_indicadores sem anon')
ok(/producao_frigorifico/.test(mig) && !/FROM public\.desossa_rendimento/.test(mig), 'numerador = producao_frigorifico, nunca desossa_rendimento (linhas explodidas)')
ok(/pt\.pessoas >= 5/.test(mig), 'dia com menos de 5 pessoas = sem dado')
ok(!/UPDATE public\.(ind_|prod_(?!indicador_meta))/.test(mig), 'não altera dado de cliente fora da meta')

const tela = readFileSync('src/app/dashboard/produtividade/indicadores/page.tsx', 'utf8')
ok(/'sem dado'/.test(tela), 'a tela mostra "sem dado" quando não há número')
ok(/meta == null \? C\.esp/.test(tela), 'semáforo só existe com meta')
ok(/window\.print\(\)/.test(tela) && /fn_prod_indicador_meta_salvar/.test(tela), 'exporta PDF e salva meta')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\n✓ produtividade indicadores ok')
