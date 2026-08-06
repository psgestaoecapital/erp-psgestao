-- RD-41 · Gestão da remessa de pagamento (Jordana): extrato, cancelar remessa, remover item, regerar.
-- RD-26: reusa erp_remessa_pagamento/_item + fn_remessa_proxima_numeracao. RD-55: cancelar/remover NÃO apaga —
-- marca com rastro (quem/quando/motivo); o título volta ao pool automaticamente (a tela só considera remessas
-- ATIVAS: status IN gerado/enviado/retorno_parcial e itens não removidos). RD-38: não cancela o que o banco já
-- pagou (retorno_importado_em preenchido ou status retorno/concluido → bloqueia).

-- Rastro (aditivo)
ALTER TABLE public.erp_remessa_pagamento
  ADD COLUMN IF NOT EXISTS cancelada_em timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por uuid,
  ADD COLUMN IF NOT EXISTS cancelamento_motivo text;
ALTER TABLE public.erp_remessa_pagamento_item
  ADD COLUMN IF NOT EXISTS removido_em timestamptz,
  ADD COLUMN IF NOT EXISTS removido_por uuid,
  ADD COLUMN IF NOT EXISTS remocao_motivo text;

-- helper de tenant: a empresa passada tem de ser do usuário
CREATE OR REPLACE FUNCTION public.fn__remessa_pode(p_company_id uuid, p_remessa_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_remessa_company = p_company_id AND p_company_id IN (SELECT public.get_user_company_ids());
$$;

-- ── FIX1/lista · remessas recentes da empresa ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_listar(p_company_id uuid, p_limit int DEFAULT 40)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'numero_sequencial')::int DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', rp.id, 'numero_sequencial', rp.numero_sequencial, 'status', rp.status,
      'ambiente', rp.ambiente, 'arquivo_nome', rp.arquivo_nome,
      'total_titulos', rp.total_titulos, 'valor_total', rp.valor_total,
      'gerado_em', rp.gerado_em, 'retorno_importado_em', rp.retorno_importado_em,
      'pode_cancelar', (rp.retorno_importado_em IS NULL AND rp.status NOT IN ('cancelado','concluido','retorno_parcial'))
    ) AS r
    FROM public.erp_remessa_pagamento rp
    WHERE rp.company_id = p_company_id AND p_company_id IN (SELECT public.get_user_company_ids())
    ORDER BY rp.numero_sequencial DESC
    LIMIT GREATEST(1, p_limit)
  ) s;
$$;

-- ── FIX1 · extrato (relação dos boletos) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_extrato(p_remessa_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_rem record; v_itens jsonb; v_total numeric;
BEGIN
  SELECT * INTO v_rem FROM public.erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', i.id, 'erp_pagar_id', i.erp_pagar_id, 'forma', i.forma,
            'beneficiario', COALESCE(NULLIF(f.razao_social,''), NULLIF(f.nome_fantasia,''), p.descricao, '—'),
            'descricao', p.descricao, 'data_vencimento', p.data_vencimento,
            'valor', i.valor, 'status_item', i.status_item, 'ocorrencia', i.ocorrencia_retorno)
            ORDER BY p.data_vencimento NULLS LAST), '[]'::jsonb),
         COALESCE(sum(i.valor), 0)
    INTO v_itens, v_total
  FROM public.erp_remessa_pagamento_item i
  LEFT JOIN public.erp_pagar p ON p.id = i.erp_pagar_id
  LEFT JOIN public.erp_fornecedores f ON f.id = p.fornecedor_id
  WHERE i.remessa_id = p_remessa_id AND i.removido_em IS NULL;

  RETURN jsonb_build_object('sucesso', true,
    'remessa', jsonb_build_object('id', v_rem.id, 'numero_sequencial', v_rem.numero_sequencial,
      'status', v_rem.status, 'ambiente', v_rem.ambiente, 'arquivo_nome', v_rem.arquivo_nome,
      'gerado_em', v_rem.gerado_em, 'retorno_importado_em', v_rem.retorno_importado_em),
    'itens', v_itens, 'total', v_total, 'qtd', jsonb_array_length(v_itens));
END; $function$;

-- ── FIX2 · cancelar remessa inteira (título volta ao pool) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_cancelar(p_remessa_id uuid, p_company_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_rem record; v_liberados int;
BEGIN
  SELECT * INTO v_rem FROM public.erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_rem.status = 'cancelado' THEN RETURN jsonb_build_object('sucesso', true, 'ja_cancelada', true); END IF;
  IF v_rem.retorno_importado_em IS NOT NULL OR v_rem.status IN ('retorno_parcial','concluido') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_retorno',
      'orientacao', 'Esta remessa já teve retorno do banco (pagamento processado). Não dá para cancelar — se um pagamento saiu errado, é estorno bancário.');
  END IF;

  SELECT count(*) INTO v_liberados FROM public.erp_remessa_pagamento_item WHERE remessa_id = p_remessa_id AND removido_em IS NULL;
  UPDATE public.erp_remessa_pagamento
     SET status = 'cancelado', cancelada_em = now(), cancelada_por = auth.uid(), cancelamento_motivo = p_motivo
   WHERE id = p_remessa_id;
  RETURN jsonb_build_object('sucesso', true, 'id', p_remessa_id, 'titulos_liberados', v_liberados);
END; $function$;

-- ── FIX2 · remover um item (boleto indevido) — soft, recalcula totais ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_remover_item(p_item_id uuid, p_company_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_item record; v_rem record; v_qtd int; v_val numeric;
BEGIN
  SELECT * INTO v_item FROM public.erp_remessa_pagamento_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  SELECT * INTO v_rem FROM public.erp_remessa_pagamento WHERE id = v_item.remessa_id;
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_item.removido_em IS NOT NULL THEN RETURN jsonb_build_object('sucesso', true, 'ja_removido', true); END IF;
  IF v_rem.retorno_importado_em IS NOT NULL OR v_rem.status IN ('retorno_parcial','concluido','cancelado') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_retorno',
      'orientacao', 'Não dá para editar esta remessa (retorno já processado ou cancelada).');
  END IF;

  UPDATE public.erp_remessa_pagamento_item
     SET removido_em = now(), removido_por = auth.uid(), remocao_motivo = p_motivo WHERE id = p_item_id;

  SELECT count(*), COALESCE(sum(valor),0) INTO v_qtd, v_val
    FROM public.erp_remessa_pagamento_item WHERE remessa_id = v_item.remessa_id AND removido_em IS NULL;
  UPDATE public.erp_remessa_pagamento SET total_titulos = v_qtd, valor_total = v_val WHERE id = v_item.remessa_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_item_id, 'remessa_qtd', v_qtd, 'remessa_valor', v_val);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_remessa_listar(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remessa_extrato(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remessa_cancelar(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remessa_remover_item(uuid, uuid, text) TO authenticated;
