-- Viagem · V2 (fechamento) — gproduto (faixa 05). ADITIVA: tabela de eventos nova + função nova; nada existente é alterado.
-- Fronteira P&M/GE: o fechamento da viagem NÃO lança financeiro; grava o evento 'viagem_fechada' (com o resumo e os
-- lançamentos por obra) e o núcleo (GE) cria os títulos (adiantamento 5.01, reembolso 5.02, despesas a prazo) a partir dele.
CREATE TABLE IF NOT EXISTS public.erp_viagem_evento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  viagem_id   uuid NOT NULL REFERENCES public.erp_viagem(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('viagem_fechada')),
  payload     jsonb NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid,
  processado_em timestamptz,
  UNIQUE (viagem_id, tipo)
);
ALTER TABLE public.erp_viagem_evento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_viagem_evento FROM PUBLIC, anon;
DROP POLICY IF EXISTS erp_viagem_evento_ler ON public.erp_viagem_evento;
CREATE POLICY erp_viagem_evento_ler ON public.erp_viagem_evento FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.erp_viagem_evento TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_viagem_fechar(p_viagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_v public.erp_viagem%ROWTYPE; v_res jsonb;
BEGIN
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_viagem_id FOR UPDATE;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF v_v.status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem já fechada ou cancelada'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_viagem_lancamento WHERE viagem_id = p_viagem_id AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Lance ao menos uma despesa ou abastecimento antes de fechar');
  END IF;
  v_res := public.fn_viagem_resumo(p_viagem_id);
  UPDATE public.erp_viagem SET status = 'fechada', fechada_em = now(), fechada_por = auth.uid(), atualizado_em = now() WHERE id = p_viagem_id;
  INSERT INTO public.erp_viagem_evento (company_id, viagem_id, tipo, payload, criado_por)
  VALUES (v_v.company_id, p_viagem_id, 'viagem_fechada', jsonb_build_object(
    'numero', v_v.numero, 'colaborador', v_v.colaborador_nome, 'resumo', v_res,
    'lancamentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'fornecedor', l.fornecedor_nome, 'categoria', l.categoria,
        'valor', l.valor, 'obra_id', l.obra_id, 'forma_pagamento', l.forma_pagamento, 'pago_colaborador', l.pago_colaborador) ORDER BY l.data)
      FROM public.erp_viagem_lancamento l WHERE l.viagem_id = p_viagem_id AND l.excluido_em IS NULL), '[]'::jsonb)), auth.uid());
  RETURN jsonb_build_object('ok', true, 'resumo', v_res);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_fechar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_fechar(uuid) TO authenticated, service_role;
