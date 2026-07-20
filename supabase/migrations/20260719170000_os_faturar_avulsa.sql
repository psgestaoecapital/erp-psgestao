-- OS → GE · fn_os_faturar v2: fecha o elo do FLUXO REAL (OS avulsa, sem pedido).
-- O operacional novo (Recepção→Diagnóstico→Aprovação→Apontamento) cria OS via fn_os_criar SEM pedido.
-- A v1 exigia pedido_id (só faturava OS-de-pedido) → o fluxo real não fechava. Agora:
--   • OS COM pedido → REUSA o faturador canônico fn_faturar(pedido) (RD-26; erp_receber + estoque + marca pedido).
--   • OS AVULSA (sem pedido) → gera 1 título em erp_receber direto do TOTAL da OS. SEM baixa de estoque
--     (fronteira: estoque de peça é manual na semana 1, decisão CEO).
-- 🔒 Guards: já faturada → bloqueia (idempotente, RD-53 não duplica) · só entregue/pronta · valor>0 ·
--    escopo company_id · atômico (plpgsql: falhou no meio, nada persiste; OS não fica marcada sem título).
-- ⚠️ ELO FINANCEIRO — não mergear sem validação do CEO na tela.

CREATE OR REPLACE FUNCTION public.fn_os_faturar(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os record; v_res jsonb; v_first uuid;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF coalesce(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta OS já foi faturada.', 'ja_faturada', true);
  END IF;
  IF v_os.status NOT IN ('entregue', 'pronta', 'concluida', 'concluída', 'finalizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Só OS pronta/entregue pode ser faturada (situação atual: ' || coalesce(v_os.status, '?') || ').');
  END IF;

  IF v_os.pedido_id IS NOT NULL THEN
    -- CAMINHO PEDIDO (RD-26): reusa o faturador canônico. Se o pedido já foi faturado, ele RAISE → aborta.
    v_res := public.fn_faturar(v_os.pedido_id, NULL);
    IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Falha ao faturar o pedido da OS: %', coalesce(v_res->>'erro', v_res::text);
    END IF;
    v_first := (v_res->'receber_ids'->>0)::uuid;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'via', 'pedido', 'os_numero', v_os.numero,
      'qtd_titulos', v_res->'qtd_titulos_receber', 'receber_ids', v_res->'receber_ids', 'lancamento_id', v_first);
  ELSE
    -- CAMINHO AVULSO (fluxo operacional real): 1 título direto do total da OS. Sem estoque.
    IF coalesce(v_os.total, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'OS sem valor para faturar (total zerado).');
    END IF;
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, valor, data_vencimento,
      numero_documento, observacoes, ref_externa_id, ref_externa_sistema)
    VALUES (v_os.company_id, v_os.cliente_id, v_os.cliente_nome,
      v_os.numero || ' — ' || coalesce(nullif(btrim(v_os.defeito_relatado), ''), 'serviço'),
      v_os.total, CURRENT_DATE, v_os.numero,
      'Faturamento da OS ' || v_os.numero || ' (oficina)', v_os.id::text, 'oficina_os')
    RETURNING id INTO v_first;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'via', 'avulsa', 'os_numero', v_os.numero,
      'valor', v_os.total, 'receber_id', v_first, 'lancamento_id', v_first);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_os_faturar(uuid) TO authenticated;
