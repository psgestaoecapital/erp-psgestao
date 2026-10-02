// Gate · fila PSGC sem starvation (Eng. Chefe + CEO 02/10). Sem rede. A migration 20261002210000 mantém:
// 1) o trigger só enfileira no UPDATE quando muda campo que DRE/fluxo/ABC leem (o ETL Omie regrava ultima_sync a cada
//    5 min) e, quando data_emissao troca de mês, reenfileira também o mês antigo;
// 2) o worker tem anti-starvation (espera > 30 min = prioridade 0) e não engole success:false do divisional;
// 3) cron com lote 50; 4) vigia de tipo parado há mais de 1 h no briefing.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const mig = readFileSync('supabase/migrations/20261002210000_psgc_fila_anti_starvation.sql', 'utf8')
const fn = (nome: string) => { const i = mig.indexOf(`FUNCTION public.${nome}(`); return i < 0 ? '' : mig.slice(i, mig.indexOf('$$;', mig.indexOf('$$', i) + 2) + 3) }

const trg = fn('trg_psgc_enfileirar_lancamento')
for (const c of ['data_emissao', 'data_pagamento', 'valor', 'categoria', 'status', 'deleted_at', 'plano_conta_codigo', 'psgc_codigo'])
  ok(trg.includes(`'${c}'`), `trigger olha o campo ${c}`)
ok(!/'ultima_sync'|'importado_em'|'updated_at'/.test(trg), 'ultima_sync / importado_em / updated_at NÃO disparam recálculo')
ok(/IF NOT v_mudou THEN RETURN NEW; END IF;/.test(trg), 'update sem mudança relevante sai sem enfileirar')
ok(/date_trunc\('month', v_data_old\) <> date_trunc\('month', v_data\)/.test(trg) && /OLD\.company_id, 'recalcular_dre_mes', EXTRACT\(YEAR FROM v_data_old\)/.test(trg),
  'troca de mês reenfileira também o mês antigo')
ok(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/.test(trg), 'falha ao enfileirar nunca derruba a gravação do título')

const wk = fn('fn_psgc_processar_fila')
ok(/CASE WHEN created_at < now\(\) - interval '30 minutes' THEN 0 ELSE prioridade END ASC, created_at ASC/.test(wk), 'anti-starvation: > 30 min vira prioridade 0')
ok(/FOR UPDATE SKIP LOCKED/.test(wk), 'worker continua seguro para rodar em paralelo (SKIP LOCKED)')
ok(/IF NOT COALESCE\(\(v_res->>'success'\)::boolean, false\) THEN\s+RAISE EXCEPTION/.test(wk), 'popular_dre_divisional com success:false vira erro')
for (const t of ['recalcular_dre_mes', 'recalcular_abc', 'recalcular_fluxo', 'popular_dre_divisional', 'mapear_plano_contas', 'onboarding_inicial', 'reprocessar_empresa'])
  ok(wk.includes(`WHEN '${t}'`), `worker ainda trata ${t}`)
ok(/fn_psgc_processar_fila\(p_lote_max integer DEFAULT 50\)/.test(mig), 'mantém o DEFAULT do parâmetro (sem ele o CREATE OR REPLACE falha) — agora 50')
ok(/cron\.alter_job\(v_id, command := 'SELECT fn_psgc_processar_fila\(50\)'\)/.test(mig), 'cron do worker com lote 50')

const vg = fn('fn_psgc_fila_vigiar')
ok(/mais_antigo < now\(\) - interval '1 hour'/.test(vg), 'vigia: tipo com pendente há mais de 1 h')
ok(/REVOKE ALL ON FUNCTION public\.fn_psgc_fila_vigiar\(\) FROM PUBLIC, anon, authenticated;/.test(mig), 'vigia só para service_role')
ok(/alertas_pendentes_para_ceo,psgc_fila_parada/.test(mig) && /fn_briefing_sessao/.test(mig), 'vigia entra no briefing (alerta ao CEO)')
ok(!/\bDELETE\s+FROM\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'nada é apagado (RD-30)')

if (falhas) { console.error(`\ncheck-psgc-fila: ${falhas} falha(s)`); process.exit(1) }
console.log('\nFila PSGC: ok')
