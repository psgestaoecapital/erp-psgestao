// Gate (NR-36 · reapuração de setembro da Frioeste · Eng. Chefe 05/10): padrão "núcleo + porta".
// Roda no build, sem rede. A prova no dado (reapuração em transação desfeita) está na PR; o spec @pos-migration confere os acessos.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261005150010_nr36_apurar_nucleo_reapurar_servico.sql', 'utf8')

ok(/pg_get_functiondef\('public\.fn_nr36_apurar\(uuid,date,date,text\)'::regprocedure\)/.test(mig) && /âncora ausente em fn_nr36_apurar/.test(mig), 'núcleo derivado da definição VIVA, com âncora que falha se não bater')
ok(/REVOKE ALL ON FUNCTION public\.fn_nr36_apurar_nucleo\(uuid,date,date,text\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.fn_nr36_apurar_nucleo\(uuid,date,date,text\) TO service_role;/.test(mig), 'núcleo: só service_role')
ok(/REVOKE ALL ON FUNCTION public\.fn_nr36_reapurar_servico\(uuid,date,date\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.fn_nr36_reapurar_servico\(uuid,date,date\) TO service_role;/.test(mig), 'reapurar_servico: só service_role')
ok(/PERFORM public\.fn_nr36_assert\(p_company_id\);\s*RETURN public\.fn_nr36_apurar_nucleo\(p_company_id, p_dt_ini, p_dt_fim, p_cpf\);/.test(mig), 'porta = fn_nr36_assert + núcleo (uma fonte só, RD-65)')
ok(!/CREATE OR REPLACE FUNCTION public\.fn_nr36_assert/.test(mig), 'o guarda fn_nr36_assert não é tocado (RD-91)')
ok(/p_fim - p_ini > 30/.test(mig) && /periodo_maior_que_31_dias/.test(mig), 'período máximo de 31 dias por chamada')
ok(/INSERT INTO public\.nr36_pausa_apurada_backup[\s\S]*fn_nr36_apurar_nucleo\(p_company, p_ini, p_fim, NULL\)/.test(mig), 'backup carimbado ANTES de reapurar (RD-55)')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /nr36_pausa_apurada_backup FROM PUBLIC, anon, authenticated/.test(mig), 'tabela de backup com RLS e sem acesso de anon/authenticated')
ok(!/\bDELETE FROM\b|\bTRUNCATE\b|\bDROP\b/.test(mig), 'a migration não apaga nada')
ok(!/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(mig), 'higiene LGPD: nenhum CPF na migration')

if (falhas) { console.error(`\n${falhas} falha(s) (núcleo NR-36)`); process.exit(1) }
console.log('\nNúcleo + porta NR-36: ok')
