// Gate (chamado #587 · Eng. Chefe 06/10): núcleo + porta da ciência NR-36 e regenerar_servico.
// Roda no build, sem rede. A prova no dado está no spec e2e @pos-migration; aqui travamos a forma da migration.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261006070010_nr36_ciencia_nucleo_regenerar_servico.sql', 'utf8')
ok(/fn_nr36_ciencia_gerar_nucleo\(uuid, date, text\) FROM PUBLIC, anon, authenticated/.test(mig) && /fn_nr36_ciencia_gerar_nucleo\(uuid, date, text\) TO service_role/.test(mig), 'núcleo: só service_role')
ok(/fn_nr36_ciencia_regenerar_servico\(uuid, date, date, text\) FROM PUBLIC, anon, authenticated/.test(mig) && /fn_nr36_ciencia_regenerar_servico\(uuid, date, date, text\) TO service_role/.test(mig), 'regenerar_servico: só service_role')
ok(/pg_get_functiondef\('public\.fn_nr36_ciencia_gerar\(uuid,date,text\)'::regprocedure\)/.test(mig), 'núcleo gerado da definição VIVA')
ok(/RAISE EXCEPTION 'nr36 ciência núcleo: âncora de fn_nr36_ciencia_gerar não bate'/.test(mig), 'âncora falha se a definição viva mudou')
ok(/get_user_company_ids\(\)\) OR is_admin\(\)\) THEN[\s\S]*RETURN public\.fn_nr36_ciencia_gerar_nucleo\(p_company_id, p_competencia, p_cpf\)/.test(mig), 'porta = acesso + núcleo (uma fonte, RD-65)')
ok(/AND status = 'pendente'/.test(mig), 'só ciências pendentes são regeneradas')
ok(/p_fim - p_inicio > 30 THEN\s+RAISE EXCEPTION 'periodo_maximo_31_dias'/.test(mig), 'período máximo de 31 dias')
ok(!/\bDELETE FROM\b|\bTRUNCATE\b|\bDROP TABLE\b|UPDATE public\.nr36_ciencia_mensal SET (status|assinado)/.test(mig), 'não apaga nem altera assinada/recusada')
ok(!/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(mig), 'higiene LGPD: nenhum CPF na migration')

if (falhas) { console.error(`\n${falhas} falha(s) (#587 ciência)`); process.exit(1) }
console.log('\nNúcleo + porta + regenerar ciência (#587): ok')
