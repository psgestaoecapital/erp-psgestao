-- fn_financiamento_gerar_pagar: corrige ON CONFLICT + preenche o elo da parcela
-- Code: code-desenvolvedor-3
--
-- Origem: auditor_pdca_2 (PDCA jornada GE · /dashboard/gestao-empresarial/financiamento).
--
-- BUG CRITICO (elo GE financiamento -> financeiro, principio 4 da GE):
--   A funcao usava  ON CONFLICT ON CONSTRAINT erp_pagar_ref_externa_unq
--   mas essa CONSTRAINT NAO EXISTE. O que existe em erp_pagar e um INDICE unico PARCIAL:
--     uq_erp_pagar_ref_externa UNIQUE (company_id, ref_externa_sistema, ref_externa_id)
--                              WHERE (ref_externa_id IS NOT NULL)
--   "ON CONFLICT ON CONSTRAINT <nome>" exige uma constraint nomeada (pg_constraint);
--   um indice unico nao satisfaz essa sintaxe e o nome citado nem existe -> toda chamada
--   levantava 42704 "constraint erp_pagar_ref_externa_unq does not exist" e o botao
--   "Gerar titulos a pagar" NUNCA conseguia gerar titulo (0 em toda a base).
--
-- FIX:
--   1. (CRITICO) Inferencia por COLUNAS do indice parcial, com o mesmo predicado parcial:
--        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id)
--        WHERE ref_externa_id IS NOT NULL DO UPDATE ...
--   2. (MENOR) Preenche financiamento_parcelas.pagar_ref com o id do titulo gerado,
--      para o cronograma refletir "titulo ja gerado" (a coluna estava morta).
--
-- Prova RD-38 (BEGIN..ROLLBACK, GE-DEMO financiamento d34f984c, 33 parcelas nao pagas):
--   run1 INSERT = 33 · run2 (idempotente) UPDATE = 33 · total titulos distintos = 33 (sem duplicar).
--
-- Seguranca: CREATE OR REPLACE da funcao existente (SECURITY DEFINER preservado, mesma
-- assinatura, mesma guarda de permissao). Aditivo: nao apaga/altera titulo pago nem dado real.

CREATE OR REPLACE FUNCTION public.fn_financiamento_gerar_pagar(p_financiamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company  uuid;
  v_banco    text;
  v_contrato text;
  v_geradas  int := 0;
BEGIN
  SELECT company_id, banco, contrato
    INTO v_company, v_banco, v_contrato
  FROM public.financiamentos WHERE id = p_financiamento_id;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('erro','financiamento nao encontrado');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('erro','sem permissao');
  END IF;

  WITH ins AS (
    INSERT INTO public.erp_pagar (
      company_id, fornecedor_nome, descricao, categoria,
      valor, data_vencimento, data_competencia, status,
      parcela, ref_externa_id, ref_externa_sistema, importado_em
    )
    SELECT
      p.company_id,
      v_banco,
      'Financiamento '||COALESCE(v_contrato,'')||' · parcela '||p.numero,
      'Financiamento',
      COALESCE(p.valor_com_desconto, p.valor_parcela),
      p.data_vencimento,
      p.data_vencimento,
      'aberto',
      p.numero::text,
      'fin:'||p.financiamento_id||':parc:'||p.numero,
      'financiamento',
      now()
    FROM public.financiamento_parcelas p
    WHERE p.financiamento_id = p_financiamento_id
      AND lower(COALESCE(p.status,'aberta')) <> 'paga'
    ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO UPDATE
      SET valor            = EXCLUDED.valor,
          data_vencimento  = EXCLUDED.data_vencimento,
          data_competencia = EXCLUDED.data_competencia,
          ultima_sync      = now()
    RETURNING id, ref_externa_id
  ),
  upd AS (
    UPDATE public.financiamento_parcelas fp
      SET pagar_ref = ins.id::text
    FROM ins
    WHERE fp.financiamento_id = p_financiamento_id
      AND ins.ref_externa_id = 'fin:'||fp.financiamento_id||':parc:'||fp.numero
      AND fp.pagar_ref IS DISTINCT FROM ins.id::text
    RETURNING fp.id
  )
  SELECT count(*) INTO v_geradas FROM ins;

  RETURN jsonb_build_object('ok', true, 'contas_geradas_ou_atualizadas', v_geradas);
END;
$function$;

-- SEED DEMO (RD-69 · jornada demonstravel ponta a ponta na GE-DEMO).
-- Gera (idempotente) os titulos a pagar dos financiamentos da GE-DEMO (Comercio ...0004),
-- para a tela sair do vazio e o elo financiamento->financeiro ser demonstravel.
-- Escopo restrito a company DEMO; nunca toca dado de cliente real.
DO $seed$
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000004';
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo) THEN
    WITH ins AS (
      INSERT INTO public.erp_pagar (
        company_id, fornecedor_nome, descricao, categoria,
        valor, data_vencimento, data_competencia, status,
        parcela, ref_externa_id, ref_externa_sistema, importado_em
      )
      SELECT
        p.company_id,
        f.banco,
        'Financiamento '||COALESCE(f.contrato,'')||' · parcela '||p.numero,
        'Financiamento',
        COALESCE(p.valor_com_desconto, p.valor_parcela),
        p.data_vencimento,
        p.data_vencimento,
        'aberto',
        p.numero::text,
        'fin:'||p.financiamento_id||':parc:'||p.numero,
        'financiamento',
        now()
      FROM public.financiamentos f
      JOIN public.financiamento_parcelas p ON p.financiamento_id = f.id
      WHERE f.company_id = v_demo
        AND lower(COALESCE(p.status,'aberta')) <> 'paga'
      ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO UPDATE
        SET valor            = EXCLUDED.valor,
            data_vencimento  = EXCLUDED.data_vencimento,
            data_competencia = EXCLUDED.data_competencia,
            ultima_sync      = now()
      RETURNING id, ref_externa_id
    )
    UPDATE public.financiamento_parcelas fp
      SET pagar_ref = ins.id::text
    FROM ins
    WHERE fp.company_id = v_demo
      AND ins.ref_externa_id = 'fin:'||fp.financiamento_id||':parc:'||fp.numero
      AND fp.pagar_ref IS DISTINCT FROM ins.id::text;
  END IF;
END
$seed$;
