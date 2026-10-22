-- Chamado #2711 · Encerrar o OMIE: reconciliar lançamentos "fantasma" (excluídos/cancelados no OMIE
-- que a sync upsert-only nunca removeu do ERP) — receber e pagar, todas as empresas com snapshot OMIE.
--
-- SÓ cria função (nenhum dado é alterado pela migration). Padrão: DRY-RUN (relatório). Aplicar exige
-- p_aplicar=true, chamado por admin, DEPOIS da revisão (exclusão em massa de dado de cliente).
--
-- Travas (o ausente só é "fantasma" se TODAS valerem):
--  * snapshot completo e recente: jsonb_array_length = record_count, record_count < 10000 (teto da paginação),
--    imported_at dentro de p_max_idade_dias (padrão 30);
--  * lançamento do ERP com ref_externa_sistema='OMIE', vivo (deleted_at IS NULL), criado ATÉ o snapshot
--    (o criado depois não pode estar no snapshot);
--  * nunca título pago/recebido (esses saem só no relatório como divergência a justificar);
--  * ref_externa_id ausente do conjunto codigo_lancamento_omie do snapshot.
-- Remoção = soft delete (deleted_at/deleted_by + observação), reversível; nada de DELETE.

CREATE OR REPLACE FUNCTION public.fn_omie_reconciliar_fantasmas(
  p_company_id uuid DEFAULT NULL,
  p_aplicar boolean DEFAULT false,
  p_max_idade_dias int DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_emp record;
  v_lado record;
  v_snap record;
  v_ids text[];
  v_qtd int; v_tot numeric; v_pagos int; v_pagos_tot numeric;
  v_erp_qtd int; v_erp_tot numeric; v_om_qtd int;
  v_lados jsonb; v_rel jsonb := '[]'::jsonb; v_removidos int; v_acum int := 0;
  v_pular text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  -- aplicar (exclusão em massa) só empresa a empresa, depois de validar o relatório com o Rodrigo
  IF p_aplicar AND p_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'aplicar_exige_company_id');
  END IF;

  FOR v_emp IN
    SELECT DISTINCT company_id FROM omie_imports
    WHERE import_type IN ('contas_pagar','contas_receber')
      AND (p_company_id IS NULL OR company_id = p_company_id)
  LOOP
    v_lados := '[]'::jsonb;
    FOR v_lado IN
      SELECT * FROM (VALUES
        ('pagar',   'contas_pagar',   'conta_pagar_cadastro',   'erp_pagar',   'pago'),
        ('receber', 'contas_receber', 'conta_receber_cadastro', 'erp_receber', 'recebido')
      ) t(lado, itype, chave, tabela, st_quitado)
    LOOP
      SELECT * INTO v_snap FROM omie_imports
       WHERE company_id = v_emp.company_id AND import_type = v_lado.itype
       ORDER BY imported_at DESC LIMIT 1;
      IF NOT FOUND THEN CONTINUE; END IF;

      v_pular := NULL;
      IF jsonb_typeof(v_snap.import_data->v_lado.chave) <> 'array' THEN v_pular := 'snapshot_sem_lista';
      ELSIF jsonb_array_length(v_snap.import_data->v_lado.chave) <> v_snap.record_count THEN v_pular := 'snapshot_incompleto';
      ELSIF v_snap.record_count >= 10000 THEN v_pular := 'snapshot_no_teto_de_paginacao';
      ELSIF v_snap.imported_at < now() - make_interval(days => p_max_idade_dias) THEN v_pular := 'snapshot_antigo';
      END IF;

      IF v_pular IS NOT NULL THEN
        v_lados := v_lados || jsonb_build_object('lado', v_lado.lado, 'pulado', v_pular,
                   'snapshot_em', v_snap.imported_at, 'omie_qtd', v_snap.record_count);
        CONTINUE;
      END IF;

      SELECT array_agg(DISTINCT e->>'codigo_lancamento_omie') INTO v_ids
        FROM jsonb_array_elements(v_snap.import_data->v_lado.chave) e;
      v_om_qtd := coalesce(array_length(v_ids, 1), 0);

      EXECUTE format($q$
        SELECT count(*) FILTER (WHERE status <> %2$L), coalesce(sum(valor) FILTER (WHERE status <> %2$L),0),
               count(*) FILTER (WHERE status = %2$L),  coalesce(sum(valor) FILTER (WHERE status = %2$L),0)
        FROM %1$I
        WHERE company_id = $1 AND deleted_at IS NULL AND upper(ref_externa_sistema) = 'OMIE'
          AND created_at <= $2 AND NOT (ref_externa_id = ANY($3))
      $q$, v_lado.tabela, v_lado.st_quitado)
      INTO v_qtd, v_tot, v_pagos, v_pagos_tot
      USING v_emp.company_id, v_snap.imported_at, v_ids;

      EXECUTE format($q$
        SELECT count(*), coalesce(sum(valor),0) FROM %1$I
        WHERE company_id = $1 AND deleted_at IS NULL AND upper(ref_externa_sistema) = 'OMIE'
      $q$, v_lado.tabela)
      INTO v_erp_qtd, v_erp_tot USING v_emp.company_id;

      v_removidos := 0;
      IF p_aplicar AND v_qtd > 0 THEN
        EXECUTE format($q$
          UPDATE %1$I SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now(),
                 observacoes = concat_ws(E'\n', nullif(observacoes,''),
                   'Removido por reconciliação OMIE (#2711): ausente do snapshot de ' || to_char($2,'DD/MM/YYYY') || '.')
          WHERE company_id = $1 AND deleted_at IS NULL AND upper(ref_externa_sistema) = 'OMIE'
            AND created_at <= $2 AND status <> %2$L AND NOT (ref_externa_id = ANY($3))
        $q$, v_lado.tabela, v_lado.st_quitado)
        USING v_emp.company_id, v_snap.imported_at, v_ids;
        GET DIAGNOSTICS v_removidos = ROW_COUNT;
        v_acum := v_acum + v_removidos;
      END IF;

      v_lados := v_lados || jsonb_build_object(
        'lado', v_lado.lado, 'snapshot_em', v_snap.imported_at,
        'omie_qtd', v_om_qtd, 'erp_omie_qtd', v_erp_qtd, 'erp_omie_total', v_erp_tot,
        'fantasmas_qtd', v_qtd, 'fantasmas_total', v_tot,
        'divergencia_quitado_qtd', v_pagos, 'divergencia_quitado_total', v_pagos_tot,
        'removidos', v_removidos);
    END LOOP;
    v_rel := v_rel || jsonb_build_object('company_id', v_emp.company_id, 'lados', v_lados);
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'aplicado', p_aplicar, 'removidos_total', v_acum, 'empresas', v_rel);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_omie_reconciliar_fantasmas(uuid, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_omie_reconciliar_fantasmas(uuid, boolean, int) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_omie_reconciliar_fantasmas(uuid, boolean, int) IS
  '#2711 — reconcilia lançamentos OMIE (receber/pagar) com o último snapshot completo. Dry-run por padrão; admin; soft delete.';
