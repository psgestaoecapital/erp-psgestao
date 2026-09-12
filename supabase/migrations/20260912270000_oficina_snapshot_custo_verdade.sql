-- ============================================================
-- Onda 4A · custo no snapshot + matar a margem falsa de 100%
-- ============================================================
-- Auditoria em produção (KGF): 148 OS com snapshot, 127 (86%) com custo ZERO nos dois lados.
-- Duas causas:
--   1) FONTE ERRADA de custo de peça: fn_os_snapshot_custo_lucro somava erp_os_peca_solicitacao
--      (0 linhas nessas OS). As peças aprovadas de verdade estão em erp_os_diagnostico_item.
--      Confirmado seguro trocar a fonte: KGF tem 0 OS usando peca_solicitacao e 0 com
--      custo_pecas_snapshot > 0 hoje — nada regride.
--   2) SEM DADO de custo: das peças aprovadas, quase nenhuma tem custo (custo_unitario ou produto).
--      Então o custo é DESCONHECIDO, não zero. Gravar lucro=receita, margem=100% é mentira.
--
-- Esta migration reescreve fn_os_snapshot_custo_lucro para:
--   • ler custo de peça de erp_os_diagnostico_item (peça aprovada), custo conhecido =
--     COALESCE(custo_unitario do item, custo do produto do catálogo);
--   • REGRA DA VERDADE: se o custo é INCOMPLETO — alguma peça aprovada sem custo conhecido, OU
--     há serviço aprovado mas nenhuma mão de obra apurada (sem horas apontadas ou sem custo_hora) —
--     NÃO grava margem/lucro inventados: margem_snapshot=NULL, lucro_snapshot=NULL, e
--     snapshot_estimado=TRUE (bandeira "custo incompleto"). Nunca mais 100% falso.
--   • quando o custo é completo, calcula lucro/margem normalmente.
-- Sem backfill (RD-30/61): as OS antigas passam a mostrar "custo não informado" ao serem
-- recalculadas, não uma margem inventada. Assinatura da fn inalterada (sem overload).

CREATE OR REPLACE FUNCTION public.fn_os_snapshot_custo_lucro(p_os_id uuid, p_estimado boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_receita numeric; v_pecas numeric; v_horas numeric;
  v_ch jsonb; v_custo_hora numeric; v_mo numeric; v_lucro numeric; v_margem numeric;
  v_pecas_sem_custo int; v_servicos_aprovados int; v_custo_incompleto boolean;
BEGIN
  SELECT company_id INTO v_comp FROM erp_os WHERE id = p_os_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  -- receita: faturamento efetivo (inalterado)
  SELECT SUM(r.valor) INTO v_receita FROM erp_receber r
   WHERE r.company_id = v_comp AND r.ref_externa_sistema IN ('os','oficina_os')
     AND r.ref_externa_id = p_os_id::text AND r.deleted_at IS NULL;

  -- custo de PEÇA: fonte correta = itens de diagnóstico aprovados (peça).
  -- custo conhecido do item = custo_unitario; senão custo do produto do catálogo.
  -- v_pecas soma só o que tem custo conhecido; v_pecas_sem_custo conta os desconhecidos.
  SELECT
    COALESCE(SUM(COALESCE(di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) * COALESCE(di.quantidade, 1))
             FILTER (WHERE COALESCE(di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) IS NOT NULL), 0),
    COUNT(*) FILTER (WHERE COALESCE(di.custo_unitario, pr.preco_custo_medio, pr.preco_custo) IS NULL)
    INTO v_pecas, v_pecas_sem_custo
  FROM erp_os_diagnostico_item di
  LEFT JOIN erp_produtos pr ON pr.id = di.produto_id
  WHERE di.os_id = p_os_id AND di.tipo = 'peca' AND di.aprovado IS TRUE;

  -- serviços aprovados (p/ saber se falta mão de obra apurada)
  SELECT COUNT(*) INTO v_servicos_aprovados
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND tipo = 'servico' AND aprovado IS TRUE;

  -- mão de obra: horas apontadas × custo_hora
  SELECT COALESCE(SUM(COALESCE(tempo_real_h, tempo_estimado_h, 0)), 0) INTO v_horas
    FROM erp_os_apontamento WHERE os_id = p_os_id;
  v_ch := public.fn_oficina_custo_hora(v_comp, 3);
  IF COALESCE((v_ch->>'ok')::boolean, false) AND NULLIF(v_ch->>'custo_hora', '') IS NOT NULL THEN
    v_custo_hora := (v_ch->>'custo_hora')::numeric;
  END IF;
  v_mo := COALESCE(v_horas, 0) * COALESCE(v_custo_hora, 0);

  -- custo incompleto: alguma peça aprovada sem custo conhecido, OU há serviço aprovado mas a
  -- mão de obra apurada é zero (sem horas apontadas ou sem custo_hora). → custo real desconhecido.
  v_custo_incompleto := (v_pecas_sem_custo > 0)
                     OR (v_servicos_aprovados > 0 AND COALESCE(v_mo, 0) = 0);

  IF v_receita IS NULL THEN
    v_lucro := NULL; v_margem := NULL;                 -- ainda não faturou
  ELSIF v_custo_incompleto THEN
    v_lucro := NULL; v_margem := NULL;                 -- NUNCA gravar margem inflada com custo desconhecido
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
    snapshot_estimado       = v_custo_incompleto        -- TRUE = custo incompleto (margem não confiável)
  WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'receita', v_receita, 'custo_pecas', ROUND(v_pecas, 2),
    'custo_mao_obra', ROUND(v_mo, 2), 'lucro', v_lucro, 'margem', v_margem,
    'custo_incompleto', v_custo_incompleto, 'pecas_sem_custo', v_pecas_sem_custo,
    'aguardando_faturamento', (v_receita IS NULL));
END $function$;
