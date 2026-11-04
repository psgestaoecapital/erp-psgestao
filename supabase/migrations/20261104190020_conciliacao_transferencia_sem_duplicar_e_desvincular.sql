-- Chamado #6734 (Proplay, carteira da Jordana) — transferência entre contas duplicada na conciliação
-- e "Desvincular" sem efeito em movimento conciliado como transferência (tipo_invalido).
-- Code: jordana-code
--
-- (1) DADO (só Proplay b2b96eef…): o PIX de R$ 400,00 de 13/08/2026 (Cresol → Sicoob) tem 2 linhas em
--     erp_transferencia. Fica a original d1124f53… (lado débito); a duplicada 84414529… (criada ao conciliar o
--     lado crédito) sai, e o movimento b5fc01ba… volta para pendente. Cópia de segurança antes. Idempotente.
-- (2) CAUSA: fn_conciliacao_transferir passa a LIGAR o 2º lado à transferência existente (mesma empresa, data,
--     valor e contas) em vez de criar outra.
-- (3) DESVINCULAR: nova fn_conciliacao_desvincular_transferencia(movimento) — libera o movimento e remove a
--     transferência só quando nenhum outro movimento depende dela.
-- Efeito no saldo: a duplicada é a que dava R$ 400 a mais de saída na Cresol e de entrada no Sicoob.

-- ── (1) backup + correção do dado ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bkp_erp_transferencia_chamado_6734 AS
  SELECT t.* FROM public.erp_transferencia t WHERE false;
ALTER TABLE public.bkp_erp_transferencia_chamado_6734 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_erp_transferencia_chamado_6734 FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.bkp_conciliacao_movimento_chamado_6734 AS
  SELECT m.* FROM public.conciliacao_movimento m WHERE false;
ALTER TABLE public.bkp_conciliacao_movimento_chamado_6734 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_conciliacao_movimento_chamado_6734 FROM anon, authenticated;

INSERT INTO public.bkp_erp_transferencia_chamado_6734
SELECT t.* FROM public.erp_transferencia t
 WHERE t.id = '84414529-715f-4a2b-8bca-a260525bfeae'
   AND t.company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
   AND NOT EXISTS (SELECT 1 FROM public.bkp_erp_transferencia_chamado_6734 b WHERE b.id = t.id);

INSERT INTO public.bkp_conciliacao_movimento_chamado_6734
SELECT m.* FROM public.conciliacao_movimento m
 WHERE m.id = 'b5fc01ba-30ad-4313-b724-b07c37bb2f8c'
   AND m.company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
   AND NOT EXISTS (SELECT 1 FROM public.bkp_conciliacao_movimento_chamado_6734 b WHERE b.id = m.id);

-- só age se a original continua lá (nunca deixa o PIX sem transferência)
UPDATE public.conciliacao_movimento
   SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
       match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
       updated_at = now()
 WHERE id = 'b5fc01ba-30ad-4313-b724-b07c37bb2f8c'
   AND company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
   AND lancamento_tabela = 'erp_transferencia'
   AND lancamento_id = '84414529-715f-4a2b-8bca-a260525bfeae'
   AND EXISTS (SELECT 1 FROM public.erp_transferencia o WHERE o.id = 'd1124f53-4aed-482d-be81-360c8f8014b4');

DELETE FROM public.erp_transferencia
 WHERE id = '84414529-715f-4a2b-8bca-a260525bfeae'
   AND company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
   AND EXISTS (SELECT 1 FROM public.erp_transferencia o WHERE o.id = 'd1124f53-4aed-482d-be81-360c8f8014b4');

-- ── (2) causa: não duplicar transferência ao conciliar o 2º lado ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_transferir(p_movimento_id uuid, p_conta_contraparte_id uuid, p_descricao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mov RECORD; v_conta_mov uuid; v_origem uuid; v_destino uuid; v_transf_id uuid; v_ok_contra boolean; v_reuso boolean := false;
BEGIN
  SELECT cm.company_id, cm.natureza, cm.valor, cm.data_transacao, cm.descricao, cm.status,
         l.conta_bancaria_id AS conta_mov
    INTO v_mov
  FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
  WHERE cm.id = p_movimento_id;
  IF v_mov.company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','movimento nao encontrado'); END IF;
  IF v_mov.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN jsonb_build_object('ok',false,'erro','movimento ja processado: '||v_mov.status); END IF;

  v_conta_mov := v_mov.conta_mov;
  IF v_conta_mov IS NULL OR p_conta_contraparte_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','conta indefinida'); END IF;
  IF v_conta_mov = p_conta_contraparte_id THEN
    RETURN jsonb_build_object('ok',false,'erro','origem e destino iguais'); END IF;

  SELECT true INTO v_ok_contra FROM erp_banco_contas
   WHERE id = p_conta_contraparte_id AND company_id = v_mov.company_id;
  IF NOT COALESCE(v_ok_contra,false) THEN
    RETURN jsonb_build_object('ok',false,'erro','conta contraparte invalida'); END IF;

  -- Correção: decidir SOMENTE pela natureza do movimento (credito/debito).
  -- 'valor' vem sempre como numero positivo/absoluto tanto para credito quanto
  -- para debito, então usá-lo como fallback ("OR valor > 0") fazia esse ramo
  -- disparar sempre, invertendo origem/destino em toda conciliação de débito.
  IF lower(coalesce(v_mov.natureza,'')) IN ('credito','c') THEN
    v_destino := v_conta_mov; v_origem := p_conta_contraparte_id;
  ELSIF lower(coalesce(v_mov.natureza,'')) IN ('debito','d') THEN
    v_origem := v_conta_mov; v_destino := p_conta_contraparte_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'erro','natureza do movimento desconhecida: '||coalesce(v_mov.natureza,'(vazia)'));
  END IF;

  -- #6734: o outro lado do mesmo PIX já foi conciliado? (mesma empresa, data, valor e contas; transferência
  -- ligada a um movimento conciliado e ainda sem o 2º lado) → liga a esta, em vez de criar outra.
  SELECT t.id INTO v_transf_id
    FROM erp_transferencia t
   WHERE t.company_id = v_mov.company_id
     AND t.conta_origem_id = v_origem AND t.conta_destino_id = v_destino
     AND t.valor = abs(v_mov.valor) AND t.data = v_mov.data_transacao
     AND EXISTS (SELECT 1 FROM conciliacao_movimento m1
                  WHERE m1.lancamento_tabela = 'erp_transferencia' AND m1.lancamento_id = t.id
                    AND m1.status = 'conciliado' AND m1.id <> p_movimento_id)
     AND (SELECT count(*) FROM conciliacao_movimento m2
           WHERE m2.lancamento_tabela = 'erp_transferencia' AND m2.lancamento_id = t.id) = 1
   ORDER BY t.created_at
   LIMIT 1;

  IF v_transf_id IS NOT NULL THEN
    v_reuso := true;
  ELSE
    INSERT INTO erp_transferencia(company_id, conta_origem_id, conta_destino_id, valor, data, descricao, movimento_id)
    VALUES (v_mov.company_id, v_origem, v_destino, abs(v_mov.valor), v_mov.data_transacao,
            COALESCE(p_descricao, v_mov.descricao), p_movimento_id)
    RETURNING id INTO v_transf_id;
  END IF;

  UPDATE conciliacao_movimento
     SET status='conciliado', lancamento_tabela='erp_transferencia', lancamento_id=v_transf_id,
         match_origem='transferencia', match_aplicado_em=now(), match_aplicado_por=auth.uid(),
         updated_at=now()
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object('ok',true,'transferencia_id',v_transf_id,'reaproveitada',v_reuso,
    'origem',v_origem,'destino',v_destino,'valor',abs(v_mov.valor));
END $function$;

-- ── (3) desvincular movimento conciliado como transferência ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_transferencia(p_movimento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD;
  v_outro uuid;
  v_removida boolean := false;
BEGIN
  SELECT id, company_id, status, lancamento_tabela, lancamento_id INTO v_mov
    FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;
  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_mov.status <> 'conciliado' OR v_mov.lancamento_tabela IS DISTINCT FROM 'erp_transferencia'
     OR v_mov.lancamento_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_e_transferencia',
      'msg', 'Este movimento não está conciliado como transferência entre contas.');
  END IF;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE id = p_movimento_id;

  -- outro lado do mesmo PIX ainda depende da transferência? então ela fica (e passa a apontar para ele)
  SELECT m.id INTO v_outro
    FROM public.conciliacao_movimento m
   WHERE m.lancamento_tabela = 'erp_transferencia' AND m.lancamento_id = v_mov.lancamento_id
     AND m.company_id = v_mov.company_id
   LIMIT 1;

  IF v_outro IS NOT NULL THEN
    UPDATE public.erp_transferencia SET movimento_id = v_outro
     WHERE id = v_mov.lancamento_id AND company_id = v_mov.company_id AND movimento_id = p_movimento_id;
  ELSE
    DELETE FROM public.erp_transferencia
     WHERE id = v_mov.lancamento_id AND company_id = v_mov.company_id;
    v_removida := true;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'movimento_id', p_movimento_id,
    'transferencia_id', v_mov.lancamento_id, 'transferencia_removida', v_removida);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular_transferencia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_transferencia(uuid) TO authenticated, service_role;
