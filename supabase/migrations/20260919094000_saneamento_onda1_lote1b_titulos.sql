-- 🚨 Saneamento Onda 1 · Lote 1b — mais escritores de título abertos sem login (inventário #1560).
-- Contexto 6b5cad70. RDs 25·38·65·34-V5. Guarda padrão: sem JWT (interno/cron) OU service_role OU
-- admin passa; authenticated só na própria empresa (senão 42501). REVOKE anon/public; GRANT
-- authenticated, service_role. Assinatura/retorno inalterados; corpo reproduzido fiel de produção.
-- Nota (RD-38): fn_veic_custo_gerar_pagar era FALSO-POSITIVO do inventário — já tem guarda por
-- fn_veic_acesso(veiculo_id) (que usa get_user_company_ids()/is_admin()); aqui só fechamos o EXECUTE
-- de anon por higiene, sem tocar no corpo.

-- ── fn_orcamento_criar_venda — guarda direta pela empresa do parâmetro ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_orcamento_criar_venda(p_company_id uuid, p_cliente_id uuid, p_tipo_venda text DEFAULT 'venda_avulsa'::text, p_situacao text DEFAULT 'aprovado'::text, p_descricao text DEFAULT NULL::text, p_valor numeric DEFAULT 0, p_data_venda date DEFAULT CURRENT_DATE, p_vencimento date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date, p_categoria_codigo text DEFAULT NULL::text, p_emitir_nf boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_numero_venda text;
  v_receber_id uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  v_numero_venda := 'V-' || to_char(NOW(), 'YYYYMMDD-HH24MISS');
  INSERT INTO erp_receber (
    id, company_id, cliente_id, descricao, valor,
    data_vencimento, data_competencia, plano_contas_codigo, status,
    observacao, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_cliente_id,
    COALESCE(p_descricao, p_tipo_venda || ' ' || v_numero_venda),
    p_valor, p_vencimento, p_data_venda, p_categoria_codigo,
    'em_aberto',
    'Venda criada via fn_orcamento_criar_venda · ' || v_numero_venda || ' · NF=' || p_emitir_nf::text,
    NOW(), NOW()
  ) RETURNING id INTO v_receber_id;
  RETURN jsonb_build_object(
    'sucesso', true, 'numero_venda', v_numero_venda, 'receber_id', v_receber_id,
    'tipo', p_tipo_venda, 'valor', p_valor, 'cliente_id', p_cliente_id, 'emitir_nf', p_emitir_nf,
    'proximo_passo', CASE WHEN p_emitir_nf THEN 'Enviar pra fn_nfse_emitir' ELSE 'Aguardar pagamento' END
  );
END;
$function$;

-- ── fn_renegociar_inadimplencia — array de receber_ids → guarda de topo por empresa ────────────
CREATE OR REPLACE FUNCTION public.fn_renegociar_inadimplencia(p_receber_ids uuid[], p_nova_data_vencimento date, p_novo_valor_total numeric DEFAULT NULL::numeric, p_observacao text DEFAULT 'Renegociado'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_valor_original_total numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    IF EXISTS (SELECT 1 FROM erp_receber WHERE id = ANY(p_receber_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))) THEN
      RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
    END IF;
  END IF;
  SELECT SUM(valor) INTO v_valor_original_total
  FROM erp_receber WHERE id = ANY(p_receber_ids) AND deleted_at IS NULL;
  UPDATE erp_receber
  SET em_renegociacao = true,
      data_vencimento = p_nova_data_vencimento,
      valor = COALESCE(p_novo_valor_total, valor),
      observacao = COALESCE(observacao, '') || ' [RENEGOCIADO em ' || NOW()::text || ': ' || p_observacao || ']',
      updated_at = NOW()
  WHERE id = ANY(p_receber_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'sucesso', true, 'titulos_renegociados', v_count,
    'valor_original_total', v_valor_original_total,
    'valor_novo_total', COALESCE(p_novo_valor_total, v_valor_original_total),
    'nova_data_vencimento', p_nova_data_vencimento
  );
END;
$function$;

-- ── ACL ────────────────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_orcamento_criar_venda(uuid,uuid,text,text,text,numeric,date,date,text,boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_orcamento_criar_venda(uuid,uuid,text,text,text,numeric,date,date,text,boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_renegociar_inadimplencia(uuid[],date,numeric,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_renegociar_inadimplencia(uuid[],date,numeric,text) TO authenticated, service_role;
-- falso-positivo (já guardado por fn_veic_acesso): só higiene de ACL, sem tocar no corpo.
REVOKE EXECUTE ON FUNCTION public.fn_veic_custo_gerar_pagar(uuid,jsonb,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_veic_custo_gerar_pagar(uuid,jsonb,uuid) TO authenticated, service_role;
