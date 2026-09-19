-- BUG (issue #1565): "Nova venda" e importador de planilha quebrados — colunas/status inexistentes.
-- Achado no Saneamento Onda 1. erp_receber/erp_pagar NÃO têm 'plano_contas_codigo' (têm 'categoria'),
-- nem 'observacao' (têm 'observacoes'); e o CHECK de status NÃO admite 'em_aberto' (admite 'aberto').
-- Correção: plano_contas_codigo→categoria; observacao→observacoes; 'em_aberto'→'aberto'.
-- fn_orcamento_criar_venda já tem guarda (do #1562) — PRESERVADA. fn_importar_planilha_lote nasce
-- blindada (REVOKE anon + guarda padrão pela empresa). Assinaturas inalteradas. RDs 25·38·65·34-V5.

-- ── fn_orcamento_criar_venda (botão "Nova venda") ─────────────────────────────────────────────────
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
    data_vencimento, data_competencia, categoria, status,
    observacoes, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_company_id, p_cliente_id,
    COALESCE(p_descricao, p_tipo_venda || ' ' || v_numero_venda),
    p_valor, p_vencimento, p_data_venda, p_categoria_codigo,
    'aberto',
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

-- ── fn_importar_planilha_lote (importador em lote) ────────────────────────────────────────────────
-- Correção das colunas + guarda padrão pela empresa (nasce blindada). A key do payload continua
-- 'plano_contas_codigo' (contrato do front intacto); só o DESTINO vira a coluna 'categoria'.
CREATE OR REPLACE FUNCTION public.fn_importar_planilha_lote(p_company_id uuid, p_tipo text, p_lancamentos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lancamento jsonb;
  v_sucesso int := 0;
  v_falha int := 0;
  v_total_valor numeric := 0;
  v_erros jsonb := '[]'::jsonb;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  FOR v_lancamento IN SELECT * FROM jsonb_array_elements(p_lancamentos) LOOP
    BEGIN
      IF p_tipo = 'pagar' THEN
        INSERT INTO erp_pagar (
          id, company_id, descricao, valor, data_vencimento,
          data_competencia, fornecedor_id, categoria,
          status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          p_company_id,
          v_lancamento ->> 'descricao',
          (v_lancamento ->> 'valor')::numeric,
          (v_lancamento ->> 'data_vencimento')::date,
          COALESCE((v_lancamento ->> 'data_competencia')::date, (v_lancamento ->> 'data_vencimento')::date),
          (v_lancamento ->> 'fornecedor_id')::uuid,
          v_lancamento ->> 'plano_contas_codigo',
          'aberto',
          NOW(), NOW()
        );
      ELSE
        INSERT INTO erp_receber (
          id, company_id, descricao, valor, data_vencimento,
          data_competencia, cliente_id, categoria,
          status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          p_company_id,
          v_lancamento ->> 'descricao',
          (v_lancamento ->> 'valor')::numeric,
          (v_lancamento ->> 'data_vencimento')::date,
          COALESCE((v_lancamento ->> 'data_competencia')::date, (v_lancamento ->> 'data_vencimento')::date),
          (v_lancamento ->> 'cliente_id')::uuid,
          v_lancamento ->> 'plano_contas_codigo',
          'aberto',
          NOW(), NOW()
        );
      END IF;

      v_sucesso := v_sucesso + 1;
      v_total_valor := v_total_valor + (v_lancamento ->> 'valor')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_falha := v_falha + 1;
      v_erros := v_erros || jsonb_build_object(
        'lancamento', v_lancamento ->> 'descricao',
        'erro', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'tipo', p_tipo,
    'total_processados', jsonb_array_length(p_lancamentos),
    'sucesso', v_sucesso,
    'falha', v_falha,
    'total_valor_importado', v_total_valor,
    'erros', v_erros
  );
END;
$function$;

-- ── ACL: fn_importar_planilha_lote nasce blindada; fn_orcamento_criar_venda já foi fechada no #1562 ──
REVOKE EXECUTE ON FUNCTION public.fn_importar_planilha_lote(uuid,text,jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_importar_planilha_lote(uuid,text,jsonb) TO authenticated, service_role;
