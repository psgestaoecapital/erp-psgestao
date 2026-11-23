-- Hub · ONDA S-MED (tela 320) — fluxo de aprovação da medição, etapa a etapa
-- A tabela projetos_obra_medicao_etapa já existe (#5793). Aqui entram as RPCs do fluxo:
--   fn_obra_medicao_etapa_iniciar  — abre o fluxo (cria a 1ª etapa 'lancamento' pendente)
--   fn_obra_medicao_etapa_decidir  — aprova/devolve a etapa pendente atual
--   fn_obra_medicao_etapa_listar   — lê o estado do fluxo (histórico + etapa atual)
--
-- Modelo (RD-30 · tabela imutável, só por RPC):
--   * No máximo UMA etapa pendente (decisao IS NULL) por medição = a "etapa atual".
--   * Aprovar: carimba a etapa atual e abre a PRÓXIMA da cadeia padrão.
--   * Devolver (motivo obrigatório): carimba a etapa atual como 'devolvido' e REABRE a
--     etapa ANTERIOR (nova linha pendente). Nenhuma linha já decidida é alterada → histórico preservado.
--   * O TÍTULO financeiro NÃO nasce aqui (fica para a fatia de integração financeira · item 6 da spec);
--     quando a etapa 'financeiro' é aprovada, a função devolve fluxo_concluido=true para o próximo passo.
--
-- Segurança: SECURITY DEFINER (owner postgres, RLS por company_id já na tabela), guarda de empresa,
-- "quem lançou não aprova" (exceto o próprio lançamento) e alçada de Compras (fn_compras_alcada_*)
-- nas etapas 'diretoria' e 'financeiro'. Aditiva e idempotente. REVOKE anon.

CREATE INDEX IF NOT EXISTS idx_obra_medicao_etapa_medicao_ordem
  ON public.projetos_obra_medicao_etapa (medicao_id, ordem);

-- Cadeia padrão de 6 etapas (configurável por empresa em fatia futura; por ora, fixa).
CREATE OR REPLACE FUNCTION public.fn__obra_medicao_etapa_cadeia()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['lancamento','aceite_contratado','engenharia','gestao_pessoas','diretoria','financeiro']::text[] $$;

-- ───────────────────────── INICIAR ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_etapa_iniciar(p_medicao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_med   public.projetos_obra_medicao%ROWTYPE;
  v_etapa text;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_med FROM public.projetos_obra_medicao WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_med.company_id);

  -- Idempotente: se já há etapas, não recria.
  IF EXISTS (SELECT 1 FROM public.projetos_obra_medicao_etapa WHERE medicao_id = p_medicao_id) THEN
    RETURN jsonb_build_object('ok', true, 'ja_iniciado', true, 'medicao_id', p_medicao_id);
  END IF;

  v_etapa := (public.fn__obra_medicao_etapa_cadeia())[1]; -- 'lancamento'
  INSERT INTO public.projetos_obra_medicao_etapa (medicao_id, company_id, ordem, etapa, responsavel_user_id)
  VALUES (p_medicao_id, v_med.company_id, 1, v_etapa, v_med.criado_por)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_med.company_id, auth.uid(), 'projetos_obra_medicao_etapa', v_id::text, 'INICIOU_FLUXO',
          jsonb_build_object('medicao_id', p_medicao_id, 'etapa', v_etapa));

  RETURN jsonb_build_object('ok', true, 'ja_iniciado', false, 'medicao_id', p_medicao_id,
                            'etapa_atual', v_etapa, 'etapa_id', v_id);
END $function$;

-- ───────────────────────── DECIDIR ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_etapa_decidir(
  p_medicao_id uuid,
  p_decisao    text,
  p_motivo     text  DEFAULT NULL,
  p_assinatura jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_med      public.projetos_obra_medicao%ROWTYPE;
  v_cur      public.projetos_obra_medicao_etapa%ROWTYPE;
  v_cadeia   text[];
  v_idx      int;
  v_proxima  text;
  v_anterior text;
  v_alcada   jsonb;
  v_hash     text;
  v_assin    jsonb;
  v_nova_id  uuid;
  v_concluido boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_decisao NOT IN ('aprovado','devolvido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Decisão inválida (use aprovado ou devolvido).');
  END IF;

  SELECT * INTO v_med FROM public.projetos_obra_medicao WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_med.company_id);

  -- Etapa atual = única linha pendente (decisao IS NULL).
  SELECT * INTO v_cur FROM public.projetos_obra_medicao_etapa
   WHERE medicao_id = p_medicao_id AND decisao IS NULL
   ORDER BY ordem DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma etapa pendente (fluxo não iniciado ou já concluído).');
  END IF;

  v_cadeia := public.fn__obra_medicao_etapa_cadeia();
  v_idx := array_position(v_cadeia, v_cur.etapa);

  -- Regra "quem lançou não aprova": vale para toda etapa de aprovação, menos o próprio lançamento.
  IF v_cur.etapa <> 'lancamento' AND auth.uid() = v_med.criado_por THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Quem lançou a medição não pode aprovar as etapas seguintes.');
  END IF;

  -- Alçada (reaproveita a de Compras) nas etapas de dinheiro.
  IF p_decisao = 'aprovado' AND v_cur.etapa IN ('diretoria','financeiro') THEN
    -- Autoridade de aprovação = admin OU o aprovador configurado em Compras (principal/substituto).
    -- NÃO vale "pode_configurar" (quem CONFIGURA a alçada não é, por isso, quem APROVA o dinheiro).
    v_alcada := public.fn_compras_alcada_obter(v_med.company_id);
    -- COALESCE(...,false) por causa da lógica de 3 valores: com substituto NULL, um "uid IN (principal, NULL)"
    -- devolve NULL (não FALSE) e o NOT não dispararia a trava.
    IF NOT (public.is_admin()
            OR (
              (v_alcada->>'configurada')::boolean IS TRUE
              AND ( COALESCE(auth.uid() = NULLIF(v_alcada->>'aprovador_principal_id','')::uuid,  false)
                 OR COALESCE(auth.uid() = NULLIF(v_alcada->>'aprovador_substituto_id','')::uuid, false) )
            )) THEN
      RETURN jsonb_build_object('ok', false, 'erro',
        'Sem alçada para aprovar a etapa ' || v_cur.etapa || '. Procure o aprovador configurado em Compras.');
    END IF;
  END IF;

  IF p_decisao = 'devolvido' AND COALESCE(btrim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da devolução.');
  END IF;

  -- Assinatura: hash sha256 do conteúdo da medição + metadados do decisor.
  v_hash := encode(sha256(convert_to(
              coalesce(v_med.id::text,'') || '|' || coalesce(v_med.numero::text,'') || '|' ||
              coalesce(v_med.valor_total::text,'') || '|' || coalesce(v_med.competencia::text,''), 'UTF8')), 'hex');
  v_assin := coalesce(p_assinatura, '{}'::jsonb)
             || jsonb_build_object('user', auth.uid(), 'em', now(), 'hash_sha256', v_hash);

  -- Carimba a etapa atual (transição única NULL -> decidido; linha nunca mais muda).
  UPDATE public.projetos_obra_medicao_etapa
     SET decisao = p_decisao, motivo = p_motivo, decidido_por = auth.uid(),
         decidido_em = now(), assinatura = v_assin
   WHERE id = v_cur.id;

  IF p_decisao = 'aprovado' THEN
    IF v_idx IS NOT NULL AND v_idx < array_length(v_cadeia, 1) THEN
      v_proxima := v_cadeia[v_idx + 1];
      INSERT INTO public.projetos_obra_medicao_etapa (medicao_id, company_id, ordem, etapa)
      VALUES (p_medicao_id, v_med.company_id,
              (SELECT COALESCE(max(ordem),0)+1 FROM public.projetos_obra_medicao_etapa WHERE medicao_id = p_medicao_id),
              v_proxima);
    ELSE
      v_concluido := true; -- etapa final (financeiro) aprovada
    END IF;
  ELSE -- devolvido: reabre a etapa anterior
    IF v_idx IS NOT NULL AND v_idx > 1 THEN
      v_anterior := v_cadeia[v_idx - 1];
      INSERT INTO public.projetos_obra_medicao_etapa (medicao_id, company_id, ordem, etapa)
      VALUES (p_medicao_id, v_med.company_id,
              (SELECT COALESCE(max(ordem),0)+1 FROM public.projetos_obra_medicao_etapa WHERE medicao_id = p_medicao_id),
              v_anterior)
      RETURNING id INTO v_nova_id;
    END IF;
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_med.company_id, auth.uid(), 'projetos_obra_medicao_etapa', v_cur.id::text,
          CASE WHEN p_decisao='aprovado' THEN 'APROVOU_ETAPA' ELSE 'DEVOLVEU_ETAPA' END,
          jsonb_build_object('etapa', v_cur.etapa, 'motivo', p_motivo,
                             'proxima', v_proxima, 'reabriu', v_anterior, 'fluxo_concluido', v_concluido));

  RETURN jsonb_build_object('ok', true, 'etapa_decidida', v_cur.etapa, 'decisao', p_decisao,
                            'proxima_etapa', v_proxima, 'etapa_reaberta', v_anterior,
                            'fluxo_concluido', v_concluido);
END $function$;

-- ───────────────────────── LISTAR ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_etapa_listar(p_medicao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_med public.projetos_obra_medicao%ROWTYPE;
  v_atual uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_med FROM public.projetos_obra_medicao WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_med.company_id);

  SELECT id INTO v_atual FROM public.projetos_obra_medicao_etapa
   WHERE medicao_id = p_medicao_id AND decisao IS NULL ORDER BY ordem DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'medicao_id', p_medicao_id,
    'etapa_atual_id', v_atual,
    'etapas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'ordem', e.ordem, 'etapa', e.etapa,
               'decisao', e.decisao, 'motivo', e.motivo,
               'decidido_por', e.decidido_por,
               'decidido_por_nome', u.full_name,
               'decidido_em', e.decidido_em,
               'pendente', (e.decisao IS NULL),
               'assinatura', e.assinatura
             ) ORDER BY e.ordem)
      FROM public.projetos_obra_medicao_etapa e
      LEFT JOIN public.users u ON u.id = e.decidido_por
      WHERE e.medicao_id = p_medicao_id
    ), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_etapa_iniciar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_medicao_etapa_decidir(uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_medicao_etapa_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_etapa_iniciar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_etapa_decidir(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_etapa_listar(uuid) TO authenticated;
