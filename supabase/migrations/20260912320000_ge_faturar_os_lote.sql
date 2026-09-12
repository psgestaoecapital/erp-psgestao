-- ============================================================
-- Onda 0 (backend, GE) · OS → contas a receber em LOTE + classificação da fila
-- ============================================================
-- FRONTEIRA (RD-44, decidido pelo CEO 12/09): a Oficina NÃO fatura — só LISTA (visibilidade).
-- Quem fatura é a GESTÃO EMPRESARIAL. A UI destas funções vive em /dashboard/financeiro/faturar-os,
-- NUNCA na vertical /dashboard/oficina/*. Genéricas por empresa (servem p/ uma 2ª oficina no futuro).
--
-- KGF: 108 entregues sem título → prontas × sem_cliente × sem_valor (fila da Jordana).
-- fn_os_faturar (por-OS) já gera erp_receber; aqui: (a) a fila classifica, (b) lote seguro das prontas.
--
-- Decisões do CEO:
--  • lote das prontas, com preview + confirmação (front); se falhar no meio, RELATÓRIO do que passou
--    e do que pulou — nunca "deu erro" (cada OS em subtransação; uma falha não derruba o lote).
--  • sem_cliente NÃO fatura (título solto não concilia) → pula com motivo 'sem_cliente'; a tela vincula antes.
--  • sem_valor só sinaliza → pula com 'sem_valor'; não inventar valor.
--  • conta opcional (KGF tem 0 contas → título sem conta; o seletor só existe se a empresa tiver conta).
-- ESCOPO: só o TÍTULO (contas a receber). Nota fiscal é outra etapa.

-- 1) a_faturar: expõe cliente_id por linha + classifica (prontas/sem_cliente/sem_valor) nos totais
CREATE OR REPLACE FUNCTION public.fn_oficina_a_faturar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH af AS (
    SELECT o.id AS os_id, o.numero, o.cliente_nome, o.cliente_id, o.placa, o.entregue_em,
           COALESCE(o.total, 0) AS total,
           (CURRENT_DATE - COALESCE(o.entregue_em::date, o.data_conclusao, o.created_at::date)) AS dias,
           CASE WHEN COALESCE(o.total,0) <= 0 THEN 'sem_valor'
                WHEN o.cliente_id IS NULL THEN 'sem_cliente'
                ELSE 'pronta' END AS situacao
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue' AND o.excluida_em IS NULL
      AND NOT COALESCE(o.titulos_gerados, false) AND o.lancamento_id IS NULL
  )
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(af) ORDER BY af.dias DESC NULLS LAST, af.total DESC) FROM af), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*), 'soma_total', COALESCE(SUM(total), 0), 'mais_antiga_dias', COALESCE(MAX(dias), 0),
        'prontas', COUNT(*) FILTER (WHERE situacao = 'pronta'),
        'soma_prontas', COALESCE(SUM(total) FILTER (WHERE situacao = 'pronta'), 0),
        'sem_cliente', COUNT(*) FILTER (WHERE situacao = 'sem_cliente'),
        'sem_valor', COUNT(*) FILTER (WHERE situacao = 'sem_valor')
      ) FROM af)
  ) INTO v_res;
  RETURN v_res;
END $function$;

-- 2) faturar LOTE (invocada da GE): fatura só as prontas passadas; cada OS em subtransação;
--    relatório {faturadas, valor_faturado, receber_ids, puladas[{os_id,numero,motivo}]}.
CREATE OR REPLACE FUNCTION public.fn_os_faturar_lote(p_company_id uuid, p_os_ids uuid[], p_conta_bancaria_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_os record; v_r jsonb; v_fat int := 0; v_val numeric := 0;
        v_ids jsonb := '[]'::jsonb; v_puladas jsonb := '[]'::jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_os_ids IS NULL OR array_length(p_os_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lista_vazia'); END IF;

  FOREACH v_id IN ARRAY p_os_ids LOOP
    SELECT o.id, o.company_id, o.numero, COALESCE(o.total,0) AS total, o.cliente_id,
           COALESCE(o.titulos_gerados,false) AS tg, o.lancamento_id
      INTO v_os FROM erp_os o WHERE o.id = v_id;
    IF v_os.id IS NULL OR v_os.company_id <> p_company_id THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'motivo', 'fora_da_empresa'); CONTINUE; END IF;
    IF v_os.tg OR v_os.lancamento_id IS NOT NULL THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'ja_faturada'); CONTINUE; END IF;
    IF v_os.total <= 0 THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'sem_valor'); CONTINUE; END IF;
    IF v_os.cliente_id IS NULL THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'sem_cliente'); CONTINUE; END IF;
    BEGIN
      v_r := public.fn_os_faturar(v_id, p_conta_bancaria_id);
      IF COALESCE((v_r->>'ok')::boolean, false) THEN
        v_fat := v_fat + 1; v_val := v_val + v_os.total; v_ids := v_ids || to_jsonb(v_r->>'receber_id');
      ELSE
        v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', COALESCE(v_r->>'erro', 'falhou'));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_puladas := v_puladas || jsonb_build_object('os_id', v_id, 'numero', v_os.numero, 'motivo', 'erro: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'faturadas', v_fat, 'valor_faturado', v_val,
    'receber_ids', v_ids, 'puladas', v_puladas, 'qtd_puladas', jsonb_array_length(v_puladas));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_faturar_lote(uuid, uuid[], uuid) TO authenticated;
