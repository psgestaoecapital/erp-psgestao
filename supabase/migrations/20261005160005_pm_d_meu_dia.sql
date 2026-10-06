-- PM-D · Meu Dia, cronômetro, comentários com @, minhas últimas ações e anotações (CEO 02/10, visita à Pdois).
-- Nenhuma tabela nova: o cronômetro é a linha de agency_timesheet com fim_em vazio (o índice único
-- ux_agency_timesheet_timer_ativo já garante 1 aberto por pessoa); comentários com @ usam agency_job_comentarios.mencoes;
-- anotações usam agency_anotacoes (privadas do autor, RLS da P1). Esta migration só:
--   (1) menu: "Meu dia" no P&M (antes da Pauta), nos mesmos planos de "Jobs";
--   (2) textos do "?" dos campos novos;
--   (3) fn_demo_seed_pm_dia: na "Agência (P&M) - DEMO", menções com @ para o Gilberto e para o robô, anotações de cada um
--       (uma fixada) e horas apontadas hoje — idempotente; encadeada no fn_demo_reset (RD-69) e rodada uma vez agora.

-- (1) menu
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES ('pm_meu_dia', 'Meu dia', 'pm', 'pm_producao', 'Sun', '/dashboard/pm/meu-dia', 54, true,
        'Meu dia: cronômetro, meus jobs (atrasados, hoje, próximos), aprovações que vencem, menções com @, minhas últimas ações e anotações privadas.',
        '3_specific', ARRAY['pm'], false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'pm_meu_dia' FROM public.plan_modules pm WHERE pm.module_id = 'pm_jobs'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'pm_meu_dia');

-- (2) "?" dos campos
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.dia.cronometro.job', 'Meu dia', 'Job do cronômetro', 'Escolha o job em que vai trabalhar agora e toque em "Iniciar".', 'As horas caem no job sozinhas ao parar — viram custo e margem do job. O cronômetro continua contando mesmo se fechar a tela.', 'Iniciar no 24111 · Landing page Residencial Aurora.', 'Esquecer o cronômetro ligado no almoço: pare antes de sair (dá para corrigir em "Lançar horas à mão").', 40, '/dashboard/pm/meu-dia'),
 ('pm.dia.anotacao.texto', 'Meu dia', 'Anotação', 'Escreva o lembrete. Só você vê — nem o gestor.', 'Guarda o que não é tarefa de job: ligar para alguém, ideia, pendência pessoal. Fixe no topo o que é importante.', 'Ligar para a Clínica Sorriso às 15h sobre o banner.', 'Usar anotação para combinar algo com a equipe: ninguém mais vê — use o comentário do job com @.', 41, '/dashboard/pm/meu-dia'),
 ('pm.job.comentario.texto', 'Job', 'Comentário', 'Escreva e use @ para chamar alguém da equipe (a lista aparece enquanto digita).', 'Fica no histórico do job e a pessoa chamada vê no Meu dia dela.', '@Ana Ribeiro o cliente aprovou a paleta, pode seguir.', 'Combinar por WhatsApp e não registrar: a próxima pessoa no job não fica sabendo.', 42, '/dashboard/pm/pauta')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- (3) demo
CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_dia(p_company_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_demo_seed_pm_dia — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_ceo  uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r record; v_job uuid; v_com int := 0; v_not int := 0; v_hor int := 0;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;

  -- comentários com @ (para o robô e para o Gilberto), escritos pelo outro
  FOR r IN SELECT * FROM (VALUES
      (24111, v_ceo,  v_robo, '@Assistente PS a Construtora mandou as plantas novas da Aurora, atualiza a landing até hoje 17h?', 40),
      (24119, v_ceo,  v_robo, '@Assistente PS o banner do frete grátis entra na campanha de sábado — prioridade alta.', 150),
      (24136, v_ceo,  v_robo, '@Assistente PS a Academia Pulso quer o formulário com WhatsApp. Consegue incluir?', 300),
      (24101, v_robo, v_ceo,  '@Gilberto o cliente pediu a rodada A do carrossel; já mandei a versão nova na pasta.', 90),
      (24113, v_robo, v_ceo,  '@Gilberto o reels do treino está atrasado: falta a música licenciada. Você aprova a trilha da biblioteca?', 200)
    ) c(n, autor, mencionado, texto, minutos) LOOP
    SELECT id INTO v_job FROM agency_jobs WHERE company_id = v_demo AND numero = r.n::text AND 'demo-pauta' = ANY (tags) LIMIT 1;
    CONTINUE WHEN v_job IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = r.autor) OR NOT EXISTS (SELECT 1 FROM users WHERE id = r.mencionado);
    IF NOT EXISTS (SELECT 1 FROM agency_job_comentarios WHERE job_id = v_job AND texto = r.texto) THEN
      INSERT INTO agency_job_comentarios (company_id, job_id, autor_id, texto, mencoes, criado_em)
      VALUES (v_demo, v_job, r.autor, r.texto, ARRAY[r.mencionado], now() - make_interval(mins => r.minutos));
      v_com := v_com + 1;
    ELSE
      UPDATE agency_job_comentarios SET criado_em = now() - make_interval(mins => r.minutos), excluido_em = NULL
       WHERE job_id = v_job AND texto = r.texto;
    END IF;
  END LOOP;

  -- anotações privadas (uma fixada para cada um)
  FOR r IN SELECT * FROM (VALUES
      (v_robo, 'Ligar para a Clínica Sorriso às 15h sobre o banner do agendamento.', true),
      (v_robo, 'Pedir ao Bruno o arquivo aberto do folder do feirão.', false),
      (v_ceo,  'Reunião de pauta segunda 9h: levar os atrasados da equipe.', true),
      (v_ceo,  'Rever o fee da Moda Lume — 3 rodadas de ajuste no mês.', false)
    ) a(dono, texto, fixada) LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = r.dono);
    IF NOT EXISTS (SELECT 1 FROM agency_anotacoes WHERE company_id = v_demo AND user_id = r.dono AND texto = r.texto) THEN
      INSERT INTO agency_anotacoes (company_id, user_id, texto, fixada) VALUES (v_demo, r.dono, r.texto, r.fixada);
      v_not := v_not + 1;
    ELSE
      UPDATE agency_anotacoes SET excluido_em = NULL, fixada = r.fixada, atualizado_em = now()
       WHERE company_id = v_demo AND user_id = r.dono AND texto = r.texto;
    END IF;
  END LOOP;

  -- horas apontadas hoje (fechadas; o cronômetro aberto fica para quem for demonstrar)
  FOR r IN SELECT * FROM (VALUES
      (v_robo, 24111, 1.50, 9), (v_robo, 24119, 0.75, 11), (v_ceo, 24101, 1.00, 10), (v_ceo, 24113, 0.50, 14)
    ) h(dono, n, horas, hora) LOOP
    SELECT id INTO v_job FROM agency_jobs WHERE company_id = v_demo AND numero = r.n::text AND 'demo-pauta' = ANY (tags) LIMIT 1;
    CONTINUE WHEN v_job IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = r.dono);
    IF NOT EXISTS (SELECT 1 FROM agency_timesheet WHERE company_id = v_demo AND user_id = r.dono AND job_id = v_job AND data = v_hoje AND descricao = 'demo-dia') THEN
      INSERT INTO agency_timesheet (company_id, job_id, user_id, data, horas, descricao, custo_hora, inicio_em, fim_em)
      SELECT v_demo, v_job, r.dono, v_hoje, r.horas, 'demo-dia', e.custo_hora,
             ((v_hoje + make_time(r.hora, 0, 0)) AT TIME ZONE 'America/Sao_Paulo'),
             ((v_hoje + make_time(r.hora, 0, 0)) AT TIME ZONE 'America/Sao_Paulo') + make_interval(mins => (r.horas * 60)::int)
        FROM (SELECT (SELECT custo_hora FROM agency_equipe WHERE company_id = v_demo AND user_id = r.dono LIMIT 1) custo_hora) e;
      v_hor := v_hor + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'comentarios', v_com, 'anotacoes', v_not, 'horas', v_hor);
END $$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_dia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_pm_dia(uuid) TO service_role;

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_seed_pm_dia' THEN
    v_new := replace(v_def, E'  -- 28/09: a demo nunca fica sem plano',
      E'  -- 02/10 (PM-D): Meu dia — menções com @, anotações e horas de hoje\n'
      || E'  IF p_company_id = ''b0700000-0000-4000-a000-000000000002''::uuid THEN\n'
      || E'    v_res := COALESCE(v_res, ''{}''::jsonb) || jsonb_build_object(''pauta_dia'', public.fn_demo_seed_pm_dia(p_company_id));\n'
      || E'  END IF;\n\n'
      || E'  -- 28/09: a demo nunca fica sem plano');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora 28/09 nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    RAISE NOTICE 'demo meu dia → %', public.fn_demo_seed_pm_dia('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;
