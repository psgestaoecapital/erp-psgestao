-- Revenda R0.2 · Trava de ENTREGA sem nota (blueprint Tela 10)
--
-- Uma venda "aberta" (sem NF-e autorizada) NÃO pode ser marcada como entregue — hoje o botão aparecia
-- mesmo assim e a função aceitava. Regra: só entrega com NF-e autorizada; exceção só por PS_ADMIN com
-- justificativa registrada. Trava no banco (fonte da verdade) + botão da tela some sem nota.
-- veic_venda.nfe_id → erp_nfe_emitidas; "autorizada" = status='autorizada'.

-- ── View ganha nfe_autorizada (a tela lê daqui p/ mostrar/ocultar o botão) ────────────────────────────
CREATE OR REPLACE VIEW public.v_veic_venda AS
 SELECT vd.id, vd.company_id, vd.veiculo_id, v.chassi, v.modelo, v.placa, vd.cliente_nome,
    vd.data_venda, vd.valor_venda, vd.desconto_embutido_troca, vd.valor_entrada, vd.valor_financiado,
    vd.banco_nome, vd.retorno_banco, vd.situacao,
    ( SELECT COALESCE(sum(r.valor), 0::numeric) FROM veic_venda_recebimento r
        WHERE r.venda_id = vd.id AND r.devedor = 'cliente'::text) AS total_cliente,
    ( SELECT COALESCE(sum(r.valor), 0::numeric) FROM veic_venda_recebimento r
        WHERE r.venda_id = vd.id AND r.devedor = 'banco'::text) AS total_banco,
    vd.vendedor_nome, vd.created_at,
    -- R0.2: a venda tem NF-e autorizada? (habilita a entrega)
    EXISTS (SELECT 1 FROM erp_nfe_emitidas n WHERE n.id = vd.nfe_id AND n.status = 'autorizada') AS nfe_autorizada
   FROM veic_venda vd
     JOIN veic_veiculo v ON v.id = vd.veiculo_id
  WHERE vd.deleted_at IS NULL;

-- ── Trava no banco (recusa entrega sem NF autorizada; exceção PS_ADMIN + justificativa) ───────────────
DROP FUNCTION IF EXISTS public.fn_veic_venda_entregar(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.fn_veic_venda_entregar(
  p_venda_id uuid, p_user uuid, p_obs text DEFAULT NULL::text, p_forcar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_veic uuid; v_sit text; v_nfe uuid; v_nfe_status text;
  v_ps_admin boolean := EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'));
BEGIN
  SELECT company_id, veiculo_id, situacao, nfe_id INTO v_comp, v_veic, v_sit, v_nfe
    FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_cancelada'); END IF;

  SELECT status INTO v_nfe_status FROM erp_nfe_emitidas WHERE id = v_nfe;

  -- Trava: sem NF-e autorizada não entrega. Exceção só por PS_ADMIN com justificativa (registrada).
  IF v_nfe IS NULL OR coalesce(v_nfe_status,'') <> 'autorizada' THEN
    IF v_ps_admin AND p_forcar AND coalesce(btrim(p_obs),'') <> '' THEN
      INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (v_comp, auth.uid(), 'veic_venda.entrega', p_venda_id::text, 'entrega_sem_nota_forcada',
              jsonb_build_object('justificativa', p_obs, 'nfe_status', v_nfe_status));
    ELSE
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_nota_autorizada',
        'mensagem', 'Emitir nota antes de entregar. A entrega exige NF-e autorizada'
          || CASE WHEN v_ps_admin THEN ' (ou liberação de PS_ADMIN com justificativa).' ELSE '.' END);
    END IF;
  END IF;

  UPDATE veic_venda SET situacao = 'entregue' WHERE id = p_venda_id;
  PERFORM fn_veic_mudar_situacao(v_veic, 'entregue', p_user, COALESCE(p_obs, 'Veículo entregue'));
  RETURN jsonb_build_object('ok', true, 'situacao', 'entregue',
    'forcado_sem_nota', (v_nfe IS NULL OR coalesce(v_nfe_status,'') <> 'autorizada'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_venda_entregar(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_entregar(uuid, uuid, text, boolean) TO authenticated, service_role;
