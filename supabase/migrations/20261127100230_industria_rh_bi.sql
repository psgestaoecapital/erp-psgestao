-- =====================================================================
-- Indústria · RH — BI de RH (horas, extras, infrações, quadro, custo, turnover). CEO 25/11.
-- Reusa PainelGente / CustoFolhaSetor / fn_rh_custo_por / fn_rh_quadro_lotacao / fn_turnover_periodo (RD-26).
-- Infrações (RD-38 · LGPD): o AGREGADO é aberto a quem tem a empresa; a LISTA NOMINAL segue restrita (PS, dono e
-- agora o RH), com acesso registrado. Para isso o cálculo das infrações vira um helper sem permissão
-- (fn__ponto_infracoes_calc, só service_role): fn_ponto_infracoes confere o acesso + registra + chama o helper;
-- fn_rh_bi_infracoes agrega a partir do helper (sem nomes).
-- =====================================================================

-- 1) Helper SÓ de cálculo das infrações (sem checar permissão, sem registrar acesso). Expõe nomes → só service_role.
CREATE OR REPLACE FUNCTION public.fn__ponto_infracoes_calc(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text)
 RETURNS TABLE(cpf text, nome text, data date, tipo text, titulo text, descricao text, horarios text, base_legal text, gravidade text, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tol_dia_seg numeric;
  v_lim_jornada_h numeric; v_lim_extra_h numeric; v_lim_inter_h numeric;
  v_on_jornada boolean; v_on_extra boolean; v_on_impar boolean; v_on_inter boolean;
BEGIN
  v_tol_dia_seg   := coalesce((SELECT (r.params->>'tol_dia_min')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='_global'),10)*60;
  v_lim_jornada_h := coalesce((SELECT (r.params->>'limite_h')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='jornada_acima_10h'),10);
  v_lim_extra_h   := coalesce((SELECT (r.params->>'limite_h')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='extra_acima_2h'),2);
  v_lim_inter_h   := coalesce((SELECT (r.params->>'limite_h')::numeric FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='interjornada_11h'),11);
  v_on_jornada := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='jornada_acima_10h'),true);
  v_on_extra   := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='extra_acima_2h'),true);
  v_on_impar   := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='marcacao_impar'),true);
  v_on_inter   := coalesce((SELECT r.ativo FROM ind_ponto_regra r WHERE r.company_id=p_company_id AND r.tipo='interjornada_11h'),true);

  RETURN QUERY
  WITH externa AS (
    SELECT DISTINCT d.cpf FROM ind_ponto_dia d
    WHERE d.company_id=p_company_id AND EXISTS (
      SELECT 1 FROM ind_pessoa pp WHERE pp.company_id=d.company_id AND pp.jornada_externa
        AND (pp.matricula::text=d.registration_number OR pp.cpf=d.cpf))
  ),
  dia AS (
    SELECT d.cpf, d.data, coalesce(d.worked_seconds,0) AS ws,
           GREATEST(coalesce(d.worked_seconds,0)-fn_ponto_escala_segundos(d.shift),0) AS extra_seg,
           coalesce(d.total_pontos,0) AS pontos, d.department
    FROM ind_ponto_dia d
    WHERE d.company_id=p_company_id AND d.data BETWEEN p_data_ini AND p_data_fim
      AND (p_departamento IS NULL OR d.department=p_departamento)
      AND (p_cpf IS NULL OR d.cpf=p_cpf)
      AND d.cpf NOT IN (SELECT e.cpf FROM externa e)
  ),
  punch AS (
    SELECT m.cpf, m.data, min(m.datetime) AS first_ts, max(m.datetime) AS last_ts, count(*) AS n
    FROM ind_ponto_marcacao m
    WHERE m.company_id=p_company_id AND m.data BETWEEN (p_data_ini-1) AND p_data_fim
      AND (p_cpf IS NULL OR m.cpf=p_cpf) AND m.cpf NOT IN (SELECT e.cpf FROM externa e)
    GROUP BY m.cpf, m.data
  ),
  inter AS (
    SELECT p.cpf, p.data, p.first_ts,
           lag(p.last_ts) OVER (PARTITION BY p.cpf ORDER BY p.data) AS prev_last_ts
    FROM punch p
  ),
  nomes AS (SELECT DISTINCT ON (c.cpf) c.cpf, c.nome FROM ind_ponto_colaborador c WHERE c.company_id=p_company_id)
  SELECT dia.cpf, n.nome, dia.data, 'jornada_acima_10h'::text,
    'Jornada acima de '||v_lim_jornada_h||'h',
    'Trabalhou '||to_char((dia.ws/3600.0)::numeric,'FM990.0')||'h no dia (limite '||v_lim_jornada_h||'h). Possível infração — confira.',
    'trabalhadas: '||to_char((dia.ws/3600.0)::numeric,'FM990.0')||'h',
    'CLT art.58/59','alta','indicio'
  FROM dia LEFT JOIN nomes n ON n.cpf=dia.cpf
  WHERE v_on_jornada AND dia.ws > (v_lim_jornada_h*3600 + v_tol_dia_seg)
  UNION ALL
  SELECT dia.cpf, n.nome, dia.data, 'extra_acima_2h'::text,
    'Horas extras acima de '||v_lim_extra_h||'h',
    'Extras de '||to_char((dia.extra_seg/3600.0)::numeric,'FM990.0')||'h no dia (limite '||v_lim_extra_h||'h/dia). Possível infração — confira.',
    'extras: '||to_char((dia.extra_seg/3600.0)::numeric,'FM990.0')||'h',
    'CLT art.59','media','indicio'
  FROM dia LEFT JOIN nomes n ON n.cpf=dia.cpf
  WHERE v_on_extra AND dia.extra_seg > (v_lim_extra_h*3600 + v_tol_dia_seg)
  UNION ALL
  SELECT dia.cpf, n.nome, dia.data, 'marcacao_impar'::text,
    'Marcação incompleta',
    dia.pontos||' batidas no dia (nº ímpar) — entrada sem saída (ou vice-versa). A revisar antes de tratar.',
    dia.pontos||' batidas',
    'Portaria 671/2021','media','a_revisar'
  FROM dia LEFT JOIN nomes n ON n.cpf=dia.cpf
  WHERE v_on_impar AND dia.pontos>0 AND (dia.pontos % 2)=1
  UNION ALL
  SELECT inter.cpf, n.nome, inter.data, 'interjornada_11h'::text,
    'Interjornada inferior a '||v_lim_inter_h||'h',
    'Saiu '||to_char(inter.prev_last_ts,'DD/MM HH24:MI')||', voltou '||to_char(inter.first_ts,'DD/MM HH24:MI')||
      ' ('||to_char((extract(epoch FROM inter.first_ts-inter.prev_last_ts)/3600.0)::numeric,'FM990.0')||'h de descanso, mínimo '||v_lim_inter_h||'h). Possível infração — confira.',
    'descanso: '||to_char((extract(epoch FROM inter.first_ts-inter.prev_last_ts)/3600.0)::numeric,'FM990.0')||'h',
    'CLT art.66','alta','indicio'
  FROM inter LEFT JOIN nomes n ON n.cpf=inter.cpf
  WHERE v_on_inter AND inter.prev_last_ts IS NOT NULL
    AND inter.data BETWEEN p_data_ini AND p_data_fim
    AND (inter.first_ts - inter.prev_last_ts) < make_interval(hours => v_lim_inter_h::int)
  ORDER BY 3, 1, 4;
END $function$;

REVOKE ALL ON FUNCTION public.fn__ponto_infracoes_calc(uuid, date, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__ponto_infracoes_calc(uuid, date, date, text, text) TO service_role;

-- 2) fn_ponto_infracoes: mantém PS + dono, ACRESCENTA o RH da empresa; registra o acesso; chama o helper (lista nominal).
CREATE OR REPLACE FUNCTION public.fn_ponto_infracoes(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text, p_cpf text DEFAULT NULL::text)
 RETURNS TABLE(cpf text, nome text, data date, tipo text, titulo text, descricao text, horarios text, base_legal text, gravidade text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_pode boolean;
BEGIN
  v_pode := EXISTS (SELECT 1 FROM users u WHERE u.id=v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))
         OR EXISTS (SELECT 1 FROM tenant_user_roles t WHERE t.user_id=v_uid AND t.company_id=p_company_id AND t.role='CLIENT_OWNER' AND t.is_active)
         OR EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id=v_uid AND uc.company_id=p_company_id AND uc.role IN ('rh','rh_industrial'))
         OR ((public.fn_acesso_efetivo(v_uid, p_company_id)->'acessos'->>'recursos_humanos') IN ('editar','aprovar'));
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Lista nominal de infrações é restrita à equipe PS, ao dono e ao RH da empresa.';
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  SELECT p_company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'ind_ponto (infrações)',
         coalesce(p_cpf,'(todos)'), 'PONTO_INFRACOES_CONSULTA',
         jsonb_build_object('ini',p_data_ini,'fim',p_data_fim,'departamento',p_departamento);

  RETURN QUERY SELECT * FROM public.fn__ponto_infracoes_calc(p_company_id, p_data_ini, p_data_fim, p_departamento, p_cpf);
END $function$;

REVOKE ALL ON FUNCTION public.fn_ponto_infracoes(uuid, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ponto_infracoes(uuid, date, date, text, text) TO authenticated, service_role;

-- 3) BI de infrações (AGREGADO, sem nomes) — aberto a quem tem a empresa. pode_nominal diz se o drill nominal é liberado.
CREATE OR REPLACE FUNCTION public.fn_rh_bi_infracoes(p_company_id uuid, p_data_ini date, p_data_fim date, p_departamento text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_pode_nominal boolean; v_head int; v_rows jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_pode_nominal := EXISTS (SELECT 1 FROM users u WHERE u.id=v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))
    OR EXISTS (SELECT 1 FROM tenant_user_roles t WHERE t.user_id=v_uid AND t.company_id=p_company_id AND t.role='CLIENT_OWNER' AND t.is_active)
    OR EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id=v_uid AND uc.company_id=p_company_id AND uc.role IN ('rh','rh_industrial'))
    OR ((public.fn_acesso_efetivo(v_uid, p_company_id)->'acessos'->>'recursos_humanos') IN ('editar','aprovar'));
  SELECT count(DISTINCT cpf) INTO v_head FROM ind_ponto_colaborador WHERE company_id=p_company_id AND cpf IS NOT NULL;
  WITH inf AS (SELECT * FROM public.fn__ponto_infracoes_calc(p_company_id, p_data_ini, p_data_fim, p_departamento, NULL)),
  inf2 AS (
    SELECT i.tipo, i.titulo, i.base_legal, i.gravidade, i.data,
           COALESCE((SELECT c.departamento FROM ind_ponto_colaborador c WHERE c.company_id=p_company_id AND c.cpf=i.cpf LIMIT 1), '(sem setor)') AS setor
    FROM inf i)
  SELECT jsonb_build_object(
    'pode_nominal', v_pode_nominal,
    'total', (SELECT count(*) FROM inf2),
    'headcount', v_head,
    'taxa_por_100', CASE WHEN v_head > 0 THEN round((SELECT count(*) FROM inf2)::numeric * 100 / v_head, 1) ELSE NULL END,
    'por_tipo', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo',tipo,'titulo',titulo,'base_legal',base_legal,'gravidade',gravidade,'n',n) ORDER BY n DESC),'[]'::jsonb)
                 FROM (SELECT tipo, min(titulo) titulo, min(base_legal) base_legal, min(gravidade) gravidade, count(*) n FROM inf2 GROUP BY tipo) q),
    'por_gravidade', (SELECT COALESCE(jsonb_agg(jsonb_build_object('gravidade',gravidade,'n',n) ORDER BY n DESC),'[]'::jsonb)
                      FROM (SELECT gravidade, count(*) n FROM inf2 GROUP BY gravidade) q),
    'top_setores', (SELECT COALESCE(jsonb_agg(jsonb_build_object('setor',setor,'n',n) ORDER BY n DESC),'[]'::jsonb)
                    FROM (SELECT setor, count(*) n FROM inf2 GROUP BY setor ORDER BY count(*) DESC LIMIT 10) q),
    'por_dia', (SELECT COALESCE(jsonb_agg(jsonb_build_object('data',data,'n',n) ORDER BY data),'[]'::jsonb)
                FROM (SELECT data, count(*) n FROM inf2 GROUP BY data) q)
  ) INTO v_rows;
  RETURN v_rows;
END $function$;

REVOKE ALL ON FUNCTION public.fn_rh_bi_infracoes(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_bi_infracoes(uuid, date, date, text) TO authenticated, service_role;

-- 4) Cobertura do cadastro: por setor, pessoas ativas × com ficha de custo conferida (RD-98 link para cadastrar).
CREATE OR REPLACE FUNCTION public.fn_rh_bi_cobertura_cadastro(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  WITH ativos AS (
    SELECT cf.id, COALESCE(NULLIF(btrim(cf.setor), ''), '(sem setor)') AS setor,
      EXISTS (SELECT 1 FROM erp_mao_obra_custo mc WHERE mc.funcionario_id = cf.id AND mc.vigencia_fim IS NULL AND mc.conferido) AS tem_conferida
    FROM compliance_funcionarios cf WHERE cf.company_id = p_company_id AND COALESCE(cf.ativo, true)
  ),
  por AS (SELECT setor, count(*) AS ativas, count(*) FILTER (WHERE tem_conferida) AS conferidas FROM ativos GROUP BY setor)
  SELECT jsonb_build_object(
    'total_ativas', (SELECT count(*) FROM ativos),
    'total_conferidas', (SELECT count(*) FILTER (WHERE tem_conferida) FROM ativos),
    'pct_geral', CASE WHEN (SELECT count(*) FROM ativos) > 0 THEN round((SELECT count(*) FILTER (WHERE tem_conferida) FROM ativos)::numeric * 100 / (SELECT count(*) FROM ativos), 0) ELSE 0 END,
    'por_setor', (SELECT COALESCE(jsonb_agg(jsonb_build_object('setor',setor,'ativas',ativas,'conferidas',conferidas,
                   'pct', CASE WHEN ativas > 0 THEN round(conferidas::numeric * 100 / ativas, 0) ELSE 0 END) ORDER BY ativas DESC),'[]'::jsonb) FROM por)
  ) INTO v_rows;
  RETURN v_rows;
END $function$;

REVOKE ALL ON FUNCTION public.fn_rh_bi_cobertura_cadastro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rh_bi_cobertura_cadastro(uuid) TO authenticated, service_role;

-- 5) Menu: BI de RH, primeiro item do grupo RH (ordem 1).
INSERT INTO module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, is_shared, legacy)
VALUES ('industrial_rh_bi', 'BI de RH', 'industrial', 'recursos_humanos', 'BarChart3', '/dashboard/industrial/rh/bi', 1, true,
        'Painel de RH: horas e extras, infrações de ponto, quadro, custo da folha, turnover e cobertura do cadastro.', false, false)
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true, descricao = EXCLUDED.descricao, is_shared = false, legacy = false;

INSERT INTO system_screens (id, rota, area, titulo, modulo, descricao_funcional, estado_real)
VALUES (gen_random_uuid(), '/dashboard/industrial/rh/bi', 'industrial', 'BI de RH', 'industrial_rh_bi',
        'Painel de RH agregado: horas/extras/atrasos, infrações de ponto (agregado aberto; nominal restrito e registrado), quadro × real, custo da folha, turnover e cobertura do cadastro de custo.', 'pronto')
ON CONFLICT (rota) DO UPDATE SET area = EXCLUDED.area, titulo = EXCLUDED.titulo, modulo = EXCLUDED.modulo,
  descricao_funcional = EXCLUDED.descricao_funcional, atualizado_em = now();

-- 6) Ajuda de campo (RD-95) — filtros e ações da tela de BI.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, status, versao)
VALUES
 ('industrial.rh_bi.filtro_de', '/dashboard/industrial/rh/bi', 'BI de RH', 'industrial', 'De',
  'Data inicial do período que você quer analisar.',
  'Define o começo da janela de horas, infrações e turnover.',
  '01/10/2026.',
  'Se a data inicial for depois da final, não aparece nada — inverta.', 'publicado', 1),
 ('industrial.rh_bi.filtro_ate', '/dashboard/industrial/rh/bi', 'BI de RH', 'industrial', 'Até',
  'Data final do período que você quer analisar.',
  'Define o fim da janela de horas, infrações e turnover.',
  '31/10/2026.',
  'Períodos muito longos deixam o painel mais lento; prefira um mês por vez.', 'publicado', 1),
 ('industrial.rh_bi.filtro_atalho', '/dashboard/industrial/rh/bi', 'BI de RH', 'industrial', 'Atalhos de período',
  'Escolha mês atual, mês anterior ou últimos 3 meses para preencher as datas de uma vez.',
  'Agiliza a troca de período sem digitar as datas.',
  'Clique em "Mês anterior" para ver outubro.',
  'O atalho sobrescreve as datas que você tinha digitado.', 'publicado', 1),
 ('industrial.rh_bi.filtro_setor', '/dashboard/industrial/rh/bi', 'BI de RH', 'industrial', 'Setor',
  'Filtre o painel por um setor (departamento) do ponto.',
  'Mostra horas, infrações e cobertura só daquele setor.',
  'Escolha "Abate" para ver só o abate.',
  'Deixe em "Todos" para a visão da empresa inteira.', 'publicado', 1),
 ('industrial.rh_bi.infracoes_tipo', '/dashboard/industrial/rh/bi', 'BI de RH', 'industrial', 'Infrações por tipo',
  'Clique num tipo de infração para ver a lista nominal (quem, quando) — só para quem tem acesso.',
  'Leva da visão agregada à pessoa, para tratar o caso; o acesso à lista nominal fica registrado.',
  'Clique em "Interjornada inferior a 11h" para ver os dias e as pessoas.',
  'Sem acesso à lista nominal você vê só os totais; o nominal é restrito por LGPD.', 'publicado', 1),
 ('industrial.rh_bi.cobertura', '/dashboard/industrial/rh/bi', 'BI de RH', 'industrial', 'Cobertura do cadastro',
  'Mostra, por setor, quantas pessoas ativas já têm ficha de custo conferida.',
  'Aponta onde falta cadastrar custo; o link leva ao cadastro de pessoas.',
  'Setor Desossa 40/52 (77%): faltam 12 fichas.',
  'Ficha não conferida não conta na cobertura — confira a ficha para ela entrar.', 'publicado', 1)
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical,
  rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = 'publicado', versao = erp_ajuda_campo.versao + 1, atualizado_em = now();
