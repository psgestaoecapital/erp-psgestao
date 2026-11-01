-- Chamado #3963 (Pdois/Prigol e Gean; correção vale para todas as empresas) — conciliação AGRUPADA "vazia".
--
-- Prova no dado (RD-38, conferida em produção em 21/10 antes desta PR):
--   11 movimentos com status='conciliado', match_origem='agrupado', lancamento_id NULL, SEM nenhuma linha em
--   conciliacao_vinculo e SEM nenhuma baixa/título apontando para eles (erp_pagar_baixa, erp_receber_baixa,
--   erp_pagar, erp_receber .movimento_banco_id) — 6 da Pdois (06/08 a 17/08) e 5 da Gean (05/08 a 13/08).
--   Na tela: "BAIXA 0% · (sem contraparte) · Títulos da fatura (0)". O "Desvincular" chamava
--   fn_conciliacao_desvincular_movimento, que devolvia 'sem_vinculos' e não mexia em nada → movimento preso.
--
-- Causa-raiz (ainda acontecia): fn_conciliacao_desvincular (desfazer pelo TÍTULO) apaga o vínculo do título,
-- mas só volta para 'pendente' o movimento 1:1 (lancamento_id = título). Numa fatura AGRUPADA (lancamento_id
-- NULL), apagar o último vínculo deixava o movimento 'conciliado' sem título nenhum.
--
-- Correção:
--   1) fn_conciliacao_desvincular_movimento: movimento conciliado SEM vínculo, sem lancamento_id e sem nenhuma
--      baixa/título ligado → volta para 'pendente' (limpa match_*). Não estorna nada (nenhuma baixa foi criada).
--      Com baixa ligada ao movimento continua recusando, com mensagem clara.
--   2) fn_conciliacao_desvincular: ao apagar o vínculo de um título, a fatura agrupada que ficou SEM nenhum
--      vínculo volta para 'pendente' (mesmas condições). Corpo anterior reproduzido fiel (20260824120000).
--   3) Dado: os 11 movimentos do chamado voltam para 'pendente', com backup em rls2_backup. Guarda por linha:
--      só mexe no que ainda está conciliado, agrupado, sem vínculo e sem baixa. Não toca título nem baixa.
--      Em banco sem esses ids (testes) é no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Desvincular pelo MOVIMENTO (botão "Desvincular" da conciliação)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_movimento(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_vin        RECORD;
  v_reabertos  int := 0;
  v_com_ajuste int := 0;
  v_ajuste_ids jsonb := '[]'::jsonb;
  v_receber    uuid[] := '{}';
  v_pagar      uuid[] := '{}';
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id) THEN
    -- #3963: conciliado "vazio" (sem vínculo, sem título 1:1 e sem baixa ligada) → só libera o movimento.
    IF v_mov.status = 'conciliado' AND v_mov.lancamento_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = p_movimento_id)
    THEN
      UPDATE public.conciliacao_movimento
         SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
             match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
             updated_at = now()
       WHERE id = p_movimento_id;
      RETURN jsonb_build_object('sucesso', true, 'movimento_id', p_movimento_id,
        'titulos_reabertos', 0, 'titulos_com_ajuste', 0, 'titulos_com_ajuste_ids', '[]'::jsonb,
        'liberado_sem_vinculo', true, 'aviso', NULL);
    END IF;
    IF v_mov.lancamento_id IS NULL AND v_mov.status = 'conciliado' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'baixa_ligada_sem_vinculo',
        'msg', 'Este movimento tem pagamento (baixa) ligado a ele, mas nenhum título na fatura. Desfaça o pagamento pelo histórico do título e tente de novo.');
    END IF;
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vinculos',
      'msg', 'Movimento sem vínculos agrupados. Para vínculo 1:1 use a desvinculação normal.');
  END IF;

  IF v_mov.status = 'conciliado' THEN
    FOR v_vin IN
      SELECT cv.lancamento_tabela, cv.lancamento_id, cv.valor_vinculado,
             ( EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.id = cv.lancamento_id
                        AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                             OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
               OR EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = cv.lancamento_id
                        AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                             OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%')) ) AS had_ajuste
      FROM public.conciliacao_vinculo cv
      WHERE cv.movimento_id = p_movimento_id
    LOOP
      -- não subtrai valor_pago; o sync (após limpar os vínculos) desfaz só o que a conciliação fez
      IF v_vin.lancamento_tabela = 'erp_pagar' THEN
        UPDATE public.erp_pagar SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_pagar := array_append(v_pagar, v_vin.lancamento_id);
      ELSE
        UPDATE public.erp_receber SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_receber := array_append(v_receber, v_vin.lancamento_id);
      END IF;

      v_reabertos := v_reabertos + 1;
      IF v_vin.had_ajuste THEN
        v_com_ajuste := v_com_ajuste + 1;
        v_ajuste_ids := v_ajuste_ids || to_jsonb(v_vin.lancamento_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE id = p_movimento_id;

  PERFORM public.fn_receber_conciliacao_sync(x) FROM unnest(v_receber) x;
  PERFORM public.fn_pagar_conciliacao_sync(x) FROM unnest(v_pagar) x;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'titulos_reabertos', v_reabertos,
    'titulos_com_ajuste', v_com_ajuste,
    'titulos_com_ajuste_ids', v_ajuste_ids,
    'aviso', CASE WHEN v_com_ajuste > 0
      THEN format('%s título(s) tinham ajuste de juros/desconto na conciliação: a baixa foi estornada, mas confira valor/juros/desconto manualmente.', v_com_ajuste)
      ELSE NULL END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Desvincular pelo TÍTULO — não deixa fatura agrupada "conciliada" sem título (causa-raiz)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular(p_lancamento_id uuid, p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo   text := lower(regexp_replace(coalesce(p_tipo, ''), '^erp_', ''));
  v_tabela text;
  v_mov_count int := 0;
  v_vin_count int := 0;
  v_movs_agrup uuid[] := '{}';
  v_agrup_liberados int := 0;
BEGIN
  IF v_tipo NOT IN ('pagar','receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido', 'tipo_recebido', p_tipo);
  END IF;
  v_tabela := 'erp_' || v_tipo;

  -- Reseta o movimento bancário -> pendente (dispara CENARIO A do trigger = estorno da baixa)
  UPDATE public.conciliacao_movimento
     SET status = 'pendente',
         lancamento_tabela = NULL,
         lancamento_id = NULL,
         match_score = NULL,
         match_origem = NULL,
         match_aplicado_em = NULL,
         match_aplicado_por = NULL,
         updated_at = now()
   WHERE lancamento_id = p_lancamento_id
     AND lancamento_tabela = v_tabela
     AND company_id IN (SELECT get_user_company_ids());
  GET DIAGNOSTICS v_mov_count = ROW_COUNT;

  -- Reverte o vínculo no título (guard multi-tenant P2)
  IF v_tipo = 'pagar' THEN
    UPDATE public.erp_pagar
       SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id
       AND company_id IN (SELECT get_user_company_ids());
  ELSE
    UPDATE public.erp_receber
       SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id
       AND company_id IN (SELECT get_user_company_ids());
  END IF;

  -- CONC-2 (RAIZ): apaga o vínculo — sem isso ele fica órfão e a tela mantém o título "conciliado".
  WITH apagados AS (
    DELETE FROM public.conciliacao_vinculo
     WHERE lancamento_id = p_lancamento_id
       AND lancamento_tabela = v_tabela
       AND company_id IN (SELECT get_user_company_ids())
    RETURNING movimento_id
  )
  SELECT count(*), COALESCE(array_agg(DISTINCT movimento_id), '{}') INTO v_vin_count, v_movs_agrup FROM apagados;

  -- #3963: fatura AGRUPADA que ficou sem nenhum título (e sem baixa ligada) volta para Pendentes.
  UPDATE public.conciliacao_movimento m
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE m.id = ANY (v_movs_agrup)
     AND m.status = 'conciliado'
     AND m.lancamento_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = m.id);
  GET DIAGNOSTICS v_agrup_liberados = ROW_COUNT;

  -- Só falha se NADA foi desfeito (nem movimento resetado, nem vínculo removido).
  IF v_mov_count = 0 AND v_vin_count = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nenhum_movimento_encontrado',
                              'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
  END IF;

  RETURN jsonb_build_object('sucesso', true,
                            'movimentos_resetados', v_mov_count,
                            'vinculos_removidos', v_vin_count,
                            'agrupados_liberados', v_agrup_liberados,
                            'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Dado: libera os 11 movimentos do chamado #3963 (Pdois 6 + Gean 5), com backup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS rls2_backup;
REVOKE ALL ON SCHEMA rls2_backup FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE _c3963_ids (id uuid PRIMARY KEY, company_id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO _c3963_ids (id, company_id) VALUES
  -- Pdois/Prigol
  ('7963471a-87d4-4301-bd39-e8a08f90cc5f', '36b69d77-b4ea-414b-8519-2ff6621c8de7'),  -- 06/08 crédito 3.772,00
  ('dbb37626-913c-45f8-86de-12adb92cbb35', '36b69d77-b4ea-414b-8519-2ff6621c8de7'),  -- 11/08 crédito 8.117,00
  ('2f843df7-d73c-4d13-a6a2-744e24111056', '36b69d77-b4ea-414b-8519-2ff6621c8de7'),  -- 13/08 débito 939,63
  ('5ec6d38f-3a60-403e-b68b-2c3f9598dae8', '36b69d77-b4ea-414b-8519-2ff6621c8de7'),  -- 17/08 crédito 795,00
  ('b2c5755a-3fd5-4b6c-90df-aeca0933995d', '36b69d77-b4ea-414b-8519-2ff6621c8de7'),  -- 17/08 débito 1.303,64
  ('bd8f98a7-5914-46de-87ef-44a9770eeac9', '36b69d77-b4ea-414b-8519-2ff6621c8de7'),  -- 17/08 débito 823,78
  -- Gean
  ('1a6d278f-1fcc-4c63-8da2-7d7ba34e1ab0', 'a462e13f-0f51-4c54-abe8-4474b591633b'),  -- 05/08 débito 2.693,70
  ('d5eeafcf-baa7-493b-b3d2-d2e76692626d', 'a462e13f-0f51-4c54-abe8-4474b591633b'),  -- 06/08 débito 828,55
  ('04d6e68e-cf1c-4b3d-b057-b52b0f85c756', 'a462e13f-0f51-4c54-abe8-4474b591633b'),  -- 13/08 débito 7.849,21
  ('21b8dbdf-094d-4c4b-a47a-85a12fecf2f0', 'a462e13f-0f51-4c54-abe8-4474b591633b'),  -- 13/08 crédito 1.280,00
  ('d084d86a-c976-45b0-aab4-e7dbabc734f2', 'a462e13f-0f51-4c54-abe8-4474b591633b');  -- 13/08 débito 1.136,33

CREATE TABLE IF NOT EXISTS rls2_backup.conciliacao_movimento_bkp_c3963_20261021 AS
SELECT m.*, now() AS snapshot_em
  FROM public.conciliacao_movimento m
  JOIN _c3963_ids i ON i.id = m.id AND i.company_id = m.company_id;

DO $$
DECLARE v_livres int; v_liberados int;
BEGIN
  SELECT count(*) INTO v_livres
    FROM public.conciliacao_movimento m
    JOIN _c3963_ids i ON i.id = m.id AND i.company_id = m.company_id
   WHERE m.status = 'conciliado' AND m.match_origem = 'agrupado' AND m.lancamento_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = m.id);
  RAISE NOTICE '[c3963] ANTES: conciliados vazios a liberar=% (esperado 11 em produção, 0 em teste)', v_livres;

  UPDATE public.conciliacao_movimento m
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
    FROM _c3963_ids i
   WHERE i.id = m.id AND i.company_id = m.company_id
     AND m.status = 'conciliado' AND m.match_origem = 'agrupado' AND m.lancamento_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = m.id);
  GET DIAGNOSTICS v_liberados = ROW_COUNT;
  RAISE NOTICE '[c3963] DEPOIS: movimentos voltaram para pendente=%', v_liberados;
END $$;
