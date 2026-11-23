-- 20261125050035 · code-desenvolvedor-3 · PDCA 23/11 (msg 31b3a978)
-- Cascade de soft-delete das baixas ÓRFÃS de erp_receber_baixa na DEMO GE (004).
--
-- Contexto (irmã do leak de contas #5920): o #5747 passou a purgar (soft-delete) o lixo de
-- erp_receber da DEMO, e o purgador fn_demo_ge_receber_purgar_lixo_teste cascateia as baixas
-- do receber que purga NAQUELA rodada. Mas as baixas cujo erp_receber PAI foi soft-deletado em
-- rodada ANTERIOR (antes do cascade existir) nunca foram cascateadas e ficaram "vivas" órfãs.
--
-- RD-38 (provado no dado 23/11, DEMO GE b0700000-...-0004):
--   • erp_receber_baixa vivas: 39.164; dessas 39.161 referenciam um erp_receber SOFT-DELETADO
--     (órfãs) e só 3 um receber vivo (estas NÃO são tocadas);
--   • risco: histórico/conciliação que leem erp_receber_baixa sem filtrar o deleted_at do pai
--     exibem até ~39k baixas fantasma (algumas com movimento_banco_id → "conciliado" fantasma).
--   • há 3 órfãs em empresas NÃO-demo → a limpeza é company-scoped e guardada por is_demo;
--     NUNCA toca essas 3 nem qualquer dado de cliente.
--
-- Correção (aditiva, idempotente, SÓ-DEMO): estende o purgador #5747 com um bloco que soft-deleta
-- as baixas órfãs (pai já soft-deletado), com backup antes, e roda a limpeza uma vez para a DEMO GE.
-- O purgador é chamado pela rotina de banco de testes/e2e; com o bloco novo ele passa a se
-- auto-curar a cada rodada (a lista não volta a acumular baixa fantasma).

CREATE OR REPLACE FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tit int := 0;
  v_bx  int := 0;
  v_orf int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_ausente_ou_nao_demo');
  END IF;

  CREATE TEMP TABLE _lixo_c3 ON COMMIT DROP AS
  SELECT r.id
    FROM public.erp_receber r
   WHERE r.company_id = p_company
     AND r.deleted_at IS NULL
     AND NOT (
          COALESCE(r.descricao    ILIKE 'DEMO-GE-FIN%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Demo%', false)
       OR COALESCE(r.numero_documento, '') ~ '^(PED|DEMO)'
     )
     AND (
          COALESCE(r.cliente_nome ILIKE 'Cliente E2E %', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Antigo', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Novo', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Aceita%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Achado%', false)
       OR COALESCE(r.cliente_nome ILIKE 'CIELO ACEITE%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Unificar duplicado%', false)
       OR COALESCE(r.cliente_nome ILIKE 'E2E %', false)
       OR COALESCE(r.descricao    ILIKE '%E2E%', false)
       OR COALESCE(r.descricao    ILIKE 'Contas500%', false)
       OR COALESCE(r.descricao    ILIKE 'Aceita%', false)
     );

  INSERT INTO public.erp_receber_lixo_teste_bkp_c3 (receber_id, company_id, cliente_nome, descricao, valor, status, deleted_at_old)
  SELECT r.id, r.company_id, r.cliente_nome, r.descricao, r.valor, r.status, r.deleted_at
    FROM public.erp_receber r JOIN _lixo_c3 l ON l.id = r.id
  ON CONFLICT (receber_id) DO NOTHING;

  INSERT INTO public.erp_receber_baixa_lixo_teste_bkp_c3 (baixa_id, receber_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.receber_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_receber_baixa b JOIN _lixo_c3 l ON l.id = b.receber_id
   WHERE b.deleted_at IS NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  UPDATE public.erp_receber_baixa b
     SET deleted_at = now()
    FROM _lixo_c3 l
   WHERE b.receber_id = l.id
     AND b.deleted_at IS NULL;
  GET DIAGNOSTICS v_bx = ROW_COUNT;

  UPDATE public.erp_receber r
     SET deleted_at = now()
    FROM _lixo_c3 l
   WHERE r.id = l.id
     AND r.deleted_at IS NULL;
  GET DIAGNOSTICS v_tit = ROW_COUNT;

  -- 23/11 (code-desenvolvedor-3 · PDCA 31b3a978): cascade das baixas ÓRFÃS — baixas vivas cujo
  -- erp_receber PAI já está soft-deletado (purga de rodada anterior sem cascade). Company-scoped e
  -- guardado por is_demo (validado no topo); as 3 baixas de pai VIVO não entram (r.deleted_at IS NOT NULL).
  INSERT INTO public.erp_receber_baixa_lixo_teste_bkp_c3 (baixa_id, receber_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.receber_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_receber_baixa b
    JOIN public.erp_receber r ON r.id = b.receber_id
   WHERE b.company_id = p_company
     AND b.deleted_at IS NULL
     AND r.deleted_at IS NOT NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  UPDATE public.erp_receber_baixa b
     SET deleted_at = now()
    FROM public.erp_receber r
   WHERE b.company_id = p_company
     AND b.receber_id = r.id
     AND b.deleted_at IS NULL
     AND r.deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_orf = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'company', p_company,
    'titulos_purgados', v_tit, 'baixas_purgadas', v_bx, 'baixas_orfas_purgadas', v_orf);
END
$function$;

-- One-time: roda a limpeza (com o cascade de órfãs) para a DEMO GE. A função valida is_demo.
SELECT public.fn_demo_ge_receber_purgar_lixo_teste('b0700000-0000-4000-a000-000000000004'::uuid);
