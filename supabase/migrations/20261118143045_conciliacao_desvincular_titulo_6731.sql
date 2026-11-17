-- #6731 (Pdois/Prigol) — Conciliação: desvincular títulos SEPARADAMENTE numa fatura agrupada.
--
-- Hoje, para desfazer o vínculo errado de UM título dentro de uma conciliação agrupada,
-- o usuário é obrigado a desvincular a fatura INTEIRA (fn_conciliacao_desvincular_movimento),
-- o que reabre todos os títulos e gera retrabalho. Esta função, ADITIVA, remove só o vínculo
-- de um título: ele volta a Aberto, a baixa que a conciliação criou é estornada pelo sync, e
-- os demais títulos continuam vinculados. Quando era o último vínculo, o movimento volta a Pendentes
-- (mesmo efeito do desvincular completo).
--
-- Reaproveita a mesma mecânica já validada em fn_conciliacao_desvincular_movimento:
--   limpa o vínculo → solta o título (conciliado=false, movimento_banco_id=NULL) → fn_*_conciliacao_sync
-- que, ao recomputar a partir de conciliacao_vinculo, desfaz a baixa de origem 'conciliacao' daquele movimento.
--
-- RLS/segurança: SECURITY DEFINER com checagem company-scoped (get_user_company_ids/is_admin), como as demais.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_titulo(
  p_movimento_id      uuid,
  p_lancamento_tabela text,
  p_lancamento_id     uuid,
  p_operador_id       uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_had_ajuste boolean := false;
  v_restantes  int;
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF p_lancamento_tabela NOT IN ('erp_pagar', 'erp_receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tabela_invalida',
      'msg', 'Tabela do título inválida; use a desvinculação da fatura.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conciliacao_vinculo
     WHERE movimento_id = p_movimento_id
       AND lancamento_tabela = p_lancamento_tabela
       AND lancamento_id = p_lancamento_id
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'vinculo_nao_encontrado',
      'msg', 'Este título não está vinculado a esta conciliação.');
  END IF;

  -- mesmo critério de aviso do desvincular agrupado: título com ajuste de juros/desconto na conciliação
  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT EXISTS (SELECT 1 FROM public.erp_pagar p WHERE p.id = p_lancamento_id
             AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                  OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
      INTO v_had_ajuste;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = p_lancamento_id
             AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                  OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%'))
      INTO v_had_ajuste;
  END IF;

  -- remove só o vínculo deste título
  DELETE FROM public.conciliacao_vinculo
   WHERE movimento_id = p_movimento_id
     AND lancamento_tabela = p_lancamento_tabela
     AND lancamento_id = p_lancamento_id;

  -- reabre o título e sincroniza (o sync, lendo conciliacao_vinculo, estorna só a baixa deste movimento)
  IF p_lancamento_tabela = 'erp_pagar' THEN
    UPDATE public.erp_pagar SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id AND company_id = v_mov.company_id;
    PERFORM public.fn_pagar_conciliacao_sync(p_lancamento_id);
  ELSE
    UPDATE public.erp_receber SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id AND company_id = v_mov.company_id;
    PERFORM public.fn_receber_conciliacao_sync(p_lancamento_id);
  END IF;

  -- se não sobrou nenhum vínculo, o movimento volta para Pendentes (igual ao desvincular completo)
  SELECT count(*) INTO v_restantes FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;
  IF v_restantes = 0 THEN
    UPDATE public.conciliacao_movimento
       SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
           match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
           updated_at = now()
     WHERE id = p_movimento_id;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'lancamento_id', p_lancamento_id,
    'vinculos_restantes', v_restantes,
    'movimento_liberado', (v_restantes = 0),
    'teve_ajuste', v_had_ajuste,
    'aviso', CASE WHEN v_had_ajuste
      THEN 'Este título tinha ajuste de juros/desconto na conciliação: a baixa foi estornada, confira valor/juros/desconto manualmente.'
      ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular_titulo(uuid, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_titulo(uuid, text, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_conciliacao_desvincular_titulo(uuid, text, uuid, uuid) IS
  '#6731 — desvincula UM título de uma conciliação agrupada (os demais permanecem). Estorna a baixa do movimento via sync; se era o último vínculo, o movimento volta a Pendentes.';
