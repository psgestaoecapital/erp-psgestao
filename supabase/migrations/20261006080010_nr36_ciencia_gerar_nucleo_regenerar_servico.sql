-- #587 · núcleo + porta das ciências mensais NR-36 (Eng. Chefe 06/10, mensagem bcebc26f).
--  • fn_nr36_ciencia_gerar_nucleo: o cálculo de fn_nr36_ciencia_gerar SEM o assert de acesso; só service_role.
--    Definição VIVA lida com pg_get_functiondef (lição #2010). A única mudança: gerado_por vira parâmetro (não há auth.uid()).
--  • fn_nr36_ciencia_gerar (porta da tela): mesmo assert de antes + chamada ao núcleo (uma fonte só, RD-65).
--  • fn_nr36_ciencia_regenerar_servico: só service_role, máx. 31 dias; regenera SÓ as ciências PENDENTES afetadas.
--    Assinadas e recusadas ficam intocadas (RD-81: o núcleo só atualiza status='pendente'). A versão anterior da pendente
--    vai para nr36_ciencia_mensal_historico pelo trigger fn_nr36_ciencia_versionar (que também incrementa a versão).
-- Esta migration não altera nenhuma linha de cliente (só funções).

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar_nucleo(p_company_id uuid, p_competencia date, p_cpf text DEFAULT NULL::text, p_gerado_por uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_n int := 0; v_reg record; v_resumo jsonb; v_detalhe jsonb; v_snap jsonb; v_hash text;
BEGIN
  FOR v_reg IN
    SELECT DISTINCT c.id AS colaborador_id, c.cpf, c.nome, c.matricula, c.pis, c.funcao, c.departamento
    FROM public.ind_ponto_colaborador c
    JOIN public.nr36_pausa_apurada a ON a.company_id=c.company_id AND a.cpf=c.cpf AND a.tipo='termica_253'
      AND a.data BETWEEN v_ini AND v_fim
    WHERE c.company_id=p_company_id AND (p_cpf IS NULL OR c.cpf=p_cpf)
  LOOP
    SELECT jsonb_build_object(
      'conforme', count(*) FILTER (WHERE status='conforme'),
      'desvio',   count(*) FILTER (WHERE status='desvio'),
      'pendente_confirmacao', count(*) FILTER (WHERE status='pendente_confirmacao'),
      'sem_dado', count(*) FILTER (WHERE status='sem_dado'),
      'dias_total', count(*))
      INTO v_resumo
      FROM public.nr36_pausa_apurada
     WHERE company_id=p_company_id AND cpf=v_reg.cpf AND tipo='termica_253' AND data BETWEEN v_ini AND v_fim;

    SELECT jsonb_agg(jsonb_build_object(
        'data', to_char(ap.data,'YYYY-MM-DD'),
        'status', ap.status,
        'jornada', ap.detalhe->'jornada',
        'pausas', COALESCE((
           SELECT jsonb_agg(p || jsonb_build_object('origem_label', public.fn_nr36_origem_label(p->>'fim_origem')))
           FROM jsonb_array_elements(COALESCE(ap.detalhe->'pausas','[]'::jsonb)) p
        ), '[]'::jsonb),
        'nao_realizada_estimado', ap.detalhe->'nao_realizada_estimado',
        'ajuste', CASE WHEN EXISTS (SELECT 1 FROM public.ind_ponto_pausa q WHERE q.company_id=ap.company_id AND q.cpf=ap.cpf
                                       AND q.data=ap.data AND q.raw ? 'reler')
                         OR EXISTS (SELECT 1 FROM public.nr36_batida_ajuste a WHERE a.company_id=ap.company_id AND a.cpf=ap.cpf
                                       AND a.data=ap.data AND a.removido_em IS NULL)
                       THEN public.fn__nr36_ajustes_dia(ap.company_id, ap.cpf, ap.data) END
      ) ORDER BY ap.data)
      INTO v_detalhe
      FROM public.nr36_pausa_apurada ap
     WHERE ap.company_id=p_company_id AND ap.cpf=v_reg.cpf AND ap.tipo='termica_253' AND ap.data BETWEEN v_ini AND v_fim;

    v_snap := jsonb_build_object('nome',v_reg.nome,'cpf',v_reg.cpf,'matricula',v_reg.matricula,
                                 'pis',v_reg.pis,'funcao',v_reg.funcao,'setor',v_reg.departamento);
    v_hash := md5(v_resumo::text || COALESCE(v_detalhe,'[]'::jsonb)::text);

    INSERT INTO public.nr36_ciencia_mensal
      (company_id,colaborador_id,cpf,competencia,tipo,periodo_inicio,periodo_fim,colaborador_snapshot,resumo,detalhe,documento_hash,gerado_por)
    VALUES (p_company_id,v_reg.colaborador_id,v_reg.cpf,v_comp,'termica_253',v_ini,v_fim,v_snap,v_resumo,COALESCE(v_detalhe,'[]'::jsonb),v_hash,p_gerado_por)
    ON CONFLICT (company_id,cpf,competencia,tipo) DO UPDATE
      SET colaborador_snapshot=EXCLUDED.colaborador_snapshot, resumo=EXCLUDED.resumo, detalhe=EXCLUDED.detalhe,
          documento_hash=EXCLUDED.documento_hash, gerado_em=now(), gerado_por=p_gerado_por, updated_at=now(),
          desatualizado_em=NULL, desatualizado_motivo=NULL
      -- #587 (CEO 02/10): documento assinado ou recusado nunca é sobrescrito — nova versão só por fn_nr36_ciencia_nova_versao
      WHERE public.nr36_ciencia_mensal.status = 'pendente';
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'gerados', v_n);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_gerar_nucleo(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar_nucleo(uuid, date, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_gerar(p_company_id uuid, p_competencia date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN public.fn_nr36_ciencia_gerar_nucleo(p_company_id, p_competencia, p_cpf, auth.uid());
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_nr36_ciencia_regenerar_servico(p_company uuid, p_inicio date, p_fim date, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_mes date;
  v_regen int := 0; v_n int; v_ass int; v_rec int; v_pend int; v_antes jsonb;
BEGIN
  IF p_company IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION 'periodo_invalido' USING errcode = '22023';
  END IF;
  IF p_fim - p_inicio > 30 THEN
    RAISE EXCEPTION 'periodo_maximo_31_dias' USING errcode = '22023';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'sem_motivo' USING errcode = '22023';
  END IF;
  v_mes := date_trunc('month', p_inicio)::date;
  WHILE v_mes <= p_fim LOOP
    SELECT COALESCE(jsonb_object_agg(m.id::text, m.documento_hash), '{}'::jsonb) INTO v_antes
      FROM public.nr36_ciencia_mensal m
     WHERE m.company_id = p_company AND m.competencia = v_mes AND m.tipo = 'termica_253' AND m.status = 'pendente';
    PERFORM public.fn_nr36_ciencia_gerar_nucleo(p_company, v_mes, NULL, NULL);
    UPDATE public.nr36_ciencia_mensal m SET versao_motivo = v_motivo
     WHERE m.company_id = p_company AND m.competencia = v_mes AND m.tipo = 'termica_253' AND m.status = 'pendente'
       AND v_antes ? m.id::text AND m.documento_hash IS DISTINCT FROM (v_antes->>m.id::text);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_regen := v_regen + v_n;
    v_mes := (v_mes + interval '1 month')::date;
  END LOOP;
  SELECT count(*) FILTER (WHERE status = 'assinado'), count(*) FILTER (WHERE status = 'recusado'), count(*) FILTER (WHERE status = 'pendente')
    INTO v_ass, v_rec, v_pend
    FROM public.nr36_ciencia_mensal
   WHERE company_id = p_company AND tipo = 'termica_253' AND competencia BETWEEN date_trunc('month', p_inicio)::date AND p_fim;
  RETURN jsonb_build_object('ok', true, 'regeneradas', v_regen, 'pendentes_no_periodo', v_pend,
                            'assinadas_intocadas', v_ass, 'recusadas_intocadas', v_rec, 'motivo', v_motivo);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_gerar(uuid, date, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_nr36_ciencia_regenerar_servico(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_ciencia_regenerar_servico(uuid, date, date, text) TO service_role;

-- ci-sem-guarda: fn_nr36_ciencia_gerar_nucleo — só service_role (REVOKE de PUBLIC/anon/authenticated); a porta da tela confere o acesso
-- ci-sem-guarda: fn_nr36_ciencia_regenerar_servico — só service_role (REVOKE de PUBLIC/anon/authenticated); chamada pela rotina de serviço
