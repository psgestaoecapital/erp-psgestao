-- OS-FIN · Total da OS a partir dos itens + destravar faturar (#9) e o painel custo/lucro (#7).
--
-- Causa raiz auditada (RD-38, provado com OS-2026-0098 do KGF): erp_os.total/valor_servico/
-- valor_materiais NUNCA eram preenchidos a partir dos itens (erp_os_diagnostico_item, que têm
-- preco/quantidade/aprovado/tipo). OS-0098 = 4 itens aprovados = R$ 440, mas total=0 → fn_os_faturar
-- recusa ("total zerado") e o painel custo/lucro (#7) fica "aguardando".
--
-- Achados extras da auditoria (o SPEC não os cobria) para #7:
--   • fn_os_snapshot_custo_lucro lê a receita de erp_receber por ref_externa_sistema = 'os', MAS
--     fn_os_faturar grava o título com ref_externa_sistema = 'oficina_os' → nunca casava (receita NULL
--     → aguardando). Correção: aceitar ('os','oficina_os').
--   • Nada recalculava o snapshot depois de faturar. Correção: fn_os_faturar chama o snapshot ao gerar
--     o título (caminho avulso), então o painel mostra receita/lucro na hora.
--
-- tipo real dos itens (medido): apenas 'servico' e 'peca'. Split = servico x resto (peça/material).
-- Estoque: a baixa por NF-recebida vinculada já existe no fn_os_faturar; NÃO duplico com uma segunda
-- baixa por diagnostico_item.produto_id (só 1/349 itens têm produto_id) — RD-52/RD-26.

-- 1) Núcleo INTERNO (sem guard) — recalcula e grava os totais de UMA OS a partir dos itens aprovados.
--    Usado pelo gatilho (contexto do próprio writer) e pela RPC gated. Fonte única do cálculo (RD-52).
CREATE OR REPLACE FUNCTION public.fn_os_recalcular_total_interno(p_os_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_serv numeric := 0; v_mat numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(preco * COALESCE(quantidade,1)) FILTER (WHERE tipo IN ('servico','mao_obra','mão de obra')),0),
    COALESCE(SUM(preco * COALESCE(quantidade,1)) FILTER (WHERE tipo IS NULL OR tipo NOT IN ('servico','mao_obra','mão de obra')),0)
  INTO v_serv, v_mat
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND aprovado IS TRUE;

  UPDATE erp_os SET
    valor_servico   = v_serv,
    valor_materiais = v_mat,
    total = GREATEST(v_serv + v_mat + COALESCE(valor_hora,0) + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0), 0),
    updated_at = now()
  WHERE id = p_os_id;
END $fn$;

-- 2) RPC gated (frontend/backfill) — recalcula e devolve os valores.
CREATE OR REPLACE FUNCTION public.fn_os_recalcular_total(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_serv numeric; v_mat numeric; v_total numeric;
BEGIN
  SELECT company_id INTO v_comp FROM erp_os WHERE id = p_os_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  PERFORM public.fn_os_recalcular_total_interno(p_os_id);

  SELECT valor_servico, valor_materiais, total INTO v_serv, v_mat, v_total FROM erp_os WHERE id = p_os_id;
  RETURN jsonb_build_object('ok', true, 'valor_servico', v_serv, 'valor_materiais', v_mat, 'total', v_total);
END $fn$;

-- 3) Gatilho nos itens: qualquer INSERT/UPDATE/DELETE recalcula o total da OS afetada. Mantém o total
--    sempre correto (fim de #7/#9 na raiz, para todas as OS futuras). Interno = sem guard de company.
CREATE OR REPLACE FUNCTION public.fn_os_item_recalcular_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.fn_os_recalcular_total_interno(COALESCE(NEW.os_id, OLD.os_id));
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_os_item_recalcular_total ON public.erp_os_diagnostico_item;
CREATE TRIGGER trg_os_item_recalcular_total
  AFTER INSERT OR UPDATE OR DELETE ON public.erp_os_diagnostico_item
  FOR EACH ROW EXECUTE FUNCTION public.fn_os_item_recalcular_total();

-- 4) #7: snapshot passa a reconhecer o título gravado pelo faturar (ref 'os' OU 'oficina_os').
CREATE OR REPLACE FUNCTION public.fn_os_snapshot_custo_lucro(p_os_id uuid, p_estimado boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_receita numeric; v_pecas numeric; v_horas numeric;
  v_ch jsonb; v_custo_hora numeric; v_mo numeric; v_lucro numeric; v_margem numeric;
BEGIN
  SELECT company_id INTO v_comp FROM erp_os WHERE id = p_os_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  SELECT SUM(r.valor) INTO v_receita FROM erp_receber r
   WHERE r.company_id = v_comp AND r.ref_externa_sistema IN ('os','oficina_os')
     AND r.ref_externa_id = p_os_id::text AND r.deleted_at IS NULL;
  SELECT COALESCE(SUM(COALESCE(pr.preco_custo_medio, pr.preco_custo, 0) * COALESCE(s.quantidade, 1)), 0)
    INTO v_pecas
  FROM erp_os_peca_solicitacao s
  LEFT JOIN erp_produtos pr ON pr.id = s.produto_id
  WHERE s.os_id = p_os_id AND s.status IN ('aprovado','comprado','trocada');
  SELECT COALESCE(SUM(COALESCE(tempo_real_h, tempo_estimado_h, 0)), 0)
    INTO v_horas FROM erp_os_apontamento WHERE os_id = p_os_id;
  v_ch := public.fn_oficina_custo_hora(v_comp, 3);
  IF COALESCE((v_ch->>'ok')::boolean, false) AND NULLIF(v_ch->>'custo_hora', '') IS NOT NULL THEN
    v_custo_hora := (v_ch->>'custo_hora')::numeric;
  END IF;
  v_mo := COALESCE(v_horas, 0) * COALESCE(v_custo_hora, 0);
  IF v_receita IS NULL THEN
    v_lucro := NULL; v_margem := NULL;
  ELSE
    v_lucro := v_receita - (v_pecas + v_mo);
    v_margem := CASE WHEN v_receita > 0 THEN ROUND(v_lucro / v_receita * 100, 1) ELSE NULL END;
  END IF;
  UPDATE erp_os SET
    custo_pecas_snapshot    = ROUND(v_pecas, 2),
    custo_mao_obra_snapshot = ROUND(v_mo, 2),
    receita_snapshot        = ROUND(v_receita, 2),
    lucro_snapshot          = ROUND(v_lucro, 2),
    margem_snapshot         = v_margem,
    snapshot_em             = now(),
    snapshot_estimado       = false
  WHERE id = p_os_id;
  RETURN jsonb_build_object('ok', true, 'receita', v_receita, 'custo_pecas', ROUND(v_pecas, 2),
    'custo_mao_obra', ROUND(v_mo, 2), 'lucro', v_lucro, 'margem', v_margem,
    'aguardando_faturamento', (v_receita IS NULL));
END $function$;

-- 5) fn_os_faturar: recalcula o total pelos itens ANTES do gate (destrava OS só-peças = #9) e
--    recalcula o snapshot DEPOIS de gerar o título (destrava o painel #7). Resto do fluxo intacto.
CREATE OR REPLACE FUNCTION public.fn_os_faturar(p_os_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_res jsonb; v_first uuid; v_local uuid; r record; v_baixados int := 0;
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
    -- caminho PEDIDO: fn_faturar já cuida do estoque (não duplicar aqui)
    v_res := public.fn_faturar(v_os.pedido_id, NULL);
    IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Falha ao faturar o pedido da OS: %', coalesce(v_res->>'erro', v_res::text);
    END IF;
    v_first := (v_res->'receber_ids'->>0)::uuid;
    UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'via', 'pedido', 'os_numero', v_os.numero,
      'qtd_titulos', v_res->'qtd_titulos_receber', 'receber_ids', v_res->'receber_ids', 'lancamento_id', v_first);
  ELSE
    -- OS-FIN (#9): garante o total a partir dos itens aprovados antes do gate (OS só-peças destrava).
    PERFORM public.fn_os_recalcular_total_interno(p_os_id);
    SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;

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

    -- BAIXA AUTOMÁTICA (Part 4): peças compradas via NF e vinculadas a ESTA OS saem do estoque.
    -- Só as que efetivamente entraram (estoque_movimentado=true) e têm produto_id. Roda uma vez (guard acima).
    v_local := public.fn_estoque_local_principal(v_os.company_id);
    IF v_local IS NOT NULL THEN
      FOR r IN
        SELECT ni.produto_id, ni.quantidade, ni.valor_unitario
          FROM erp_nfe_recebidas_itens ni
         WHERE ni.company_id = v_os.company_id
           AND ni.produto_id IS NOT NULL
           AND COALESCE(ni.estoque_movimentado, false) = true
           AND ni.vinculo_origem LIKE ('os:' || p_os_id::text || '%')
           AND EXISTS (SELECT 1 FROM erp_produtos p WHERE p.id = ni.produto_id AND p.company_id = v_os.company_id)
      LOOP
        PERFORM public.fn_movimentar_estoque(
          p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'saida',
          p_quantidade := r.quantidade, p_custo_unitario := COALESCE(r.valor_unitario, 0),
          p_motivo := 'Consumo em OS faturada',
          p_observacoes := 'OS ' || COALESCE(v_os.numero, ''),
          p_ref_tipo := 'os', p_ref_id := p_os_id, p_ref_numero := v_os.numero);
        v_baixados := v_baixados + 1;
      END LOOP;
    END IF;

    -- OS-FIN (#7): agora que há título (receita), recalcula o painel custo/lucro na hora.
    PERFORM public.fn_os_snapshot_custo_lucro(p_os_id, false);

    RETURN jsonb_build_object('ok', true, 'via', 'avulsa', 'os_numero', v_os.numero,
      'valor', v_os.total, 'receber_id', v_first, 'lancamento_id', v_first, 'itens_estoque_baixados', v_baixados);
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_recalcular_total(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_os_recalcular_total(uuid) TO authenticated;
