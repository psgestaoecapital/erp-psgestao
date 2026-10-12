// Gate (chamado #587 · Eng. Chefe 05/10): núcleo + porta da apuração NR-36 e reapuração por serviço.
// Roda no build, sem rede. A prova no dado está no spec e2e @pos-migration; aqui travamos a forma da migration.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261005150010_nr36_apurar_nucleo_reapurar_servico.sql', 'utf8')
ok(/fn_nr36_apurar_nucleo\(uuid, date, date, text\) FROM PUBLIC, anon, authenticated/.test(mig) && /fn_nr36_apurar_nucleo\(uuid, date, date, text\) TO service_role/.test(mig), 'núcleo: só service_role')
ok(/fn_nr36_classificar_eventos_nucleo\(uuid\) FROM PUBLIC, anon, authenticated/.test(mig), 'classificar núcleo: só service_role')
ok(/fn_nr36_reapurar_servico\(uuid, date, date\) FROM PUBLIC, anon, authenticated/.test(mig) && /fn_nr36_reapurar_servico\(uuid, date, date\) TO service_role/.test(mig), 'reapurar_servico: só service_role')
ok(/pg_get_functiondef\('public\.fn_nr36_apurar\(uuid,date,date,text\)'::regprocedure\)/.test(mig), 'núcleo gerado da definição VIVA (não da do repositório)')
ok(/RAISE EXCEPTION 'nr36 núcleo: âncora de fn_nr36_apurar não bate'/.test(mig), 'âncora falha se a definição viva mudou')
ok(/PERFORM public\.fn_nr36_assert\(p_company_id\);\s+RETURN public\.fn_nr36_apurar_nucleo\(p_company_id, p_dt_ini, p_dt_fim, p_cpf\);/.test(mig), 'porta = fn_nr36_assert + núcleo (uma fonte, RD-65)')
ok(!/CREATE OR REPLACE FUNCTION public\.fn_nr36_assert/.test(mig), 'fn_nr36_assert (guarda, RD-91) intocada')
ok(/p_fim - p_ini > 30 THEN\s+RAISE EXCEPTION 'periodo_maximo_31_dias'/.test(mig), 'período máximo de 31 dias')
ok(/INSERT INTO public\.nr36_pausa_apurada_backup[\s\S]*fn_nr36_apurar_nucleo\(p_company, p_ini, p_fim, NULL\)/.test(mig), 'backup ANTES de reapurar (RD-55)')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.nr36_pausa_apurada_backup FROM PUBLIC, anon, authenticated/.test(mig), 'tabela de backup com RLS e sem anon')
ok(!/\bDELETE FROM\b|\bTRUNCATE\b|\bDROP TABLE\b|\bUPDATE public\.nr36_pausa_apurada\b/.test(mig), 'a migration não altera nem apaga linha de cliente')
ok(!/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(mig), 'higiene LGPD: nenhum CPF na migration')

if (falhas) { console.error(`\n${falhas} falha(s) (#587 núcleo)`); process.exit(1) }
console.log('\nNúcleo + porta + reapurar (#587): ok')
