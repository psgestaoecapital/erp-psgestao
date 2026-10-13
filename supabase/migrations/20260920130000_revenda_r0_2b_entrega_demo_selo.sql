-- Revenda R0.2b · Entrega na DEMO pela flag is_demo (decisão do Eng. Chefe) — fast-follow ao #1602.
--
-- O trigger fiscal fn_bloqueia_emissao_nao_produtiva proíbe qualquer erp_nfe_emitidas em empresa que não
-- seja 'producao' → a demo nunca tem NF-e autorizada → a trava do R0.2 nunca deixaria entregar na demo.
-- Regra aprovada: entrega permitida quando (NF-e autorizada) OU (companies.is_demo = true E situacao='faturada').
-- CHAVE = is_demo (protegida por fn_set_is_demo: só PS_ADMIN, com audit, recusa empresa com dado real),
-- NUNCA ambiente_tenant (campo comum — empresa real classificada errado entregaria sem nota).
-- Produção segue ESTRITA: sem NF autorizada, recusa (exceção só PS_ADMIN com justificativa, como no #1602).
-- A entrega na demo sem nota fica registrada em audit_log_global e a tela mostra o selo "Demonstração".

-- ── View: expõe is_demo (a tela usa p/ o selo e o gate) ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_veic_venda AS
 SELECT vd.id, vd.company_id, vd.veiculo_id, v.chassi, v.modelo, v.placa, vd.cliente_nome,
    vd.data_venda, vd.valor_venda, vd.desconto_embutido_troca, vd.valor_entrada, vd.valor_financiado,
    vd.banco_nome, vd.retorno_banco, vd.situacao,
    ( SELECT COALESCE(sum(r.valor), 0::numeric) FROM veic_venda_recebimento r
        WHERE r.venda_id = vd.id AND r.devedor = 'cliente'::text) AS total_cliente,
    ( SELECT COALESCE(sum(r.valor), 0::numeric) FROM veic_venda_recebimento r
        WHERE r.venda_id = vd.id AND r.devedor = 'banco'::text) AS total_banco,
    vd.vendedor_nome, vd.created_at,
    EXISTS (SELECT 1 FROM erp_nfe_emitidas n WHERE n.id = vd.nfe_id AND n.status = 'autorizada') AS nfe_autorizada,
    COALESCE(c.is_demo, false) AS is_demo   -- R0.2b: empresa de demonstração?
   FROM veic_venda vd
     JOIN veic_veiculo v ON v.id = vd.veiculo_id
     JOIN companies c ON c.id = vd.company_id
  WHERE vd.deleted_at IS NULL;

-- ── Trava com ramo DEMO ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_entregar(
  p_venda_id uuid, p_user uuid, p_obs text DEFAULT NULL::text, p_forcar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_veic uuid; v_sit text; v_nfe uuid; v_nfe_status text;
  v_is_demo boolean; v_nf_ok boolean; v_entrega_demo boolean := false;
  v_ps_admin boolean := EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM'));
BEGIN
  SELECT company_id, veiculo_id, situacao, nfe_id INTO v_comp, v_veic, v_sit, v_nfe
    FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_cancelada'); END IF;

  SELECT status INTO v_nfe_status FROM erp_nfe_emitidas WHERE id = v_nfe;
  v_nf_ok := (v_nfe IS NOT NULL AND coalesce(v_nfe_status,'') = 'autorizada');
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = v_comp;

  IF NOT v_nf_ok THEN
    IF coalesce(v_is_demo,false) AND v_sit = 'faturada' THEN
      -- DEMO (is_demo, não ambiente_tenant): entrega sem nota fiscal real, registrada.
      v_entrega_demo := true;
      INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (v_comp, auth.uid(), 'veic_venda.entrega', p_venda_id::text, 'entrega_demo_sem_nota',
              jsonb_build_object('motivo', 'empresa de demonstração (is_demo) — sem NF-e real', 'situacao', v_sit));
    ELSIF v_ps_admin AND p_forcar AND coalesce(btrim(p_obs),'') <> '' THEN
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
    'entrega_demo_sem_nota', v_entrega_demo,
    'forcado_sem_nota', (NOT v_nf_ok AND NOT v_entrega_demo));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_venda_entregar(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_entregar(uuid, uuid, text, boolean) TO authenticated, service_role;
