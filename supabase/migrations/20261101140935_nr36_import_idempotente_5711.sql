-- #5711 (Frioeste · Karol) — "entrou parcial e faltou as pausas de alguns colaboradores; entrar
-- somente as pausas faltantes". A ind_ponto_pausa tem UNIQUE (company_id, cpf, inicio); o INSERT do
-- fn_nr36_upload_processar não tratava conflito, então reimportar o relatório do mesmo dia batia na
-- restrição e abortava a transação INTEIRA — as pausas que faltavam nunca entravam.
--
-- Correção idempotente: INSERT ... ON CONFLICT DO NOTHING. A reimportação insere SÓ o que falta,
-- conta as já existentes à parte ("duplicadas") e NUNCA sobrescreve pausa já gravada/conferida.
-- Reimportar sem novidade (tudo já existe) deixa de ser "falhou": vira sucesso com 0 novas.
-- Aditiva no comportamento; mesma assinatura. NR-36 (sensível) → revisão do Eng. Chefe.
CREATE OR REPLACE FUNCTION public.fn_nr36_upload_processar(p_upload_id uuid, p_linhas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_up nr36_upload%ROWTYPE; v_l jsonb; v_cpf text; v_data date; v_ini timestamptz; v_fim timestamptz;
  v_lidas int := 0; v_aceitas int := 0; v_rej int := 0; v_dup int := 0; v_rowcount int; v_rejd jsonb := '[]'::jsonb;
  v_pmin date; v_pmax date;
BEGIN
  SELECT * INTO v_up FROM nr36_upload WHERE id = p_upload_id;
  IF v_up.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'upload_nao_encontrado'); END IF;
  IF NOT public.fn_nr36_pode_subir(v_up.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao'); END IF;

  FOR v_l IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) LOOP
    v_lidas := v_lidas + 1;
    v_cpf := regexp_replace(COALESCE(v_l->>'cpf',''), '\D', '', 'g');
    -- CPF não cadastrado NÃO grava (nunca inventar colaborador)
    IF v_cpf = '' OR NOT EXISTS (SELECT 1 FROM ind_ponto_colaborador c
                                  WHERE c.company_id = v_up.company_id
                                    AND regexp_replace(c.cpf,'\D','','g') = v_cpf) THEN
      v_rej := v_rej + 1;
      v_rejd := v_rejd || jsonb_build_object('linha', v_lidas, 'cpf', v_l->>'cpf', 'motivo', 'cpf_nao_cadastrado');
      CONTINUE;
    END IF;
    BEGIN
      v_data := (v_l->>'data')::date;
      v_ini  := (v_l->>'inicio')::timestamptz;
      v_fim  := NULLIF(v_l->>'fim','')::timestamptz;
    EXCEPTION WHEN others THEN
      v_rej := v_rej + 1;
      v_rejd := v_rejd || jsonb_build_object('linha', v_lidas, 'cpf', v_l->>'cpf', 'motivo', 'data_hora_invalida');
      CONTINUE;
    END;
    -- período cobre TODA linha válida (inclusive a já existente), p/ a reapuração pegar o dia reimportado
    v_pmin := LEAST(v_pmin, v_data); v_pmax := GREATEST(v_pmax, v_data);
    -- #5711: idempotente — insere só o que falta; batida repetida (mesma company_id,cpf,inicio) é pulada
    INSERT INTO ind_ponto_pausa (company_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em)
    VALUES (v_up.company_id, v_cpf, v_data, v_ini, v_fim,
      COALESCE((v_l->>'duracao_seg')::int, CASE WHEN v_fim IS NOT NULL THEN EXTRACT(EPOCH FROM (v_fim - v_ini))::int END),
      NULLIF(v_l->>'tipo',''), p_upload_id, v_l, now())
    ON CONFLICT (company_id, cpf, inicio) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN v_aceitas := v_aceitas + 1; ELSE v_dup := v_dup + 1; END IF;
  END LOOP;

  -- #107 zero_linhas: só é FALHA quando nada novo entrou E nada já existia (tudo rejeitado / arquivo vazio).
  -- Reimportar um dia que já está no sistema (dup > 0) é SUCESSO com 0 novas, não falha (RD-77).
  IF v_aceitas = 0 AND v_dup = 0 THEN
    UPDATE nr36_upload SET linhas_lidas = v_lidas, linhas_aceitas = 0, linhas_rejeitadas = v_rej,
      rejeitadas_detalhe = v_rejd, status = 'falhou',
      observacao = 'Nenhuma linha foi importada (' || v_lidas || ' lida(s), ' || v_rej || ' rejeitada(s)). Confira o arquivo e reenvie.'
    WHERE id = p_upload_id;
    RETURN jsonb_build_object('ok', false, 'erro', 'zero_linhas', 'lidas', v_lidas, 'aceitas', 0, 'rejeitadas', v_rej, 'duplicadas', 0,
      'rejeitadas_detalhe', v_rejd,
      'mensagem', CASE WHEN v_lidas = 0 THEN 'O arquivo chegou sem nenhuma linha de pausa. Nada foi importado — confira o arquivo e envie de novo.'
                       ELSE 'Nenhuma das ' || v_lidas || ' linha(s) foi aceita (veja o motivo de cada uma). Nada foi importado — corrija e envie de novo.' END);
  END IF;
  UPDATE nr36_upload SET linhas_lidas = v_lidas, linhas_aceitas = v_aceitas, linhas_rejeitadas = v_rej,
    rejeitadas_detalhe = v_rejd, status = 'processado',
    observacao = CASE WHEN v_dup > 0 THEN v_dup || ' pausa(s) já estavam no sistema (reimportação) e foram mantidas; ' || v_aceitas || ' nova(s) importada(s).' ELSE NULL END,
    periodo_inicio = COALESCE(periodo_inicio, v_pmin), periodo_fim = COALESCE(periodo_fim, v_pmax)
  WHERE id = p_upload_id;

  -- dispara a apuração no período importado (o motor decide cumprida/parcial/nao_cumprida/aguardando)
  IF v_pmin IS NOT NULL THEN PERFORM public.fn_nr36_apurar(v_up.company_id, v_pmin, v_pmax); END IF;

  RETURN jsonb_build_object('ok', true, 'lidas', v_lidas, 'aceitas', v_aceitas, 'rejeitadas', v_rej, 'duplicadas', v_dup,
    'periodo', jsonb_build_object('inicio', v_pmin, 'fim', v_pmax), 'rejeitadas_detalhe', v_rejd);
END $function$;

-- Régua check_fn_guards (Regra 1): formaliza no arquivo a ACL viva da função
-- (em produção já é {authenticated, service_role}; anon/PUBLIC sem EXECUTE). Sem mudança de runtime.
REVOKE ALL ON FUNCTION public.fn_nr36_upload_processar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_upload_processar(uuid, jsonb) TO authenticated, service_role;
