-- ============================================================
-- Onda 4A · custo no snapshot + matar a margem falsa de 100%
-- ============================================================
-- Auditoria em produção (KGF, RD-38): 148 OS com snapshot, 127 (86%) com custo ZERO nos dois lados.
-- Duas causas:
--   1) FONTE ERRADA de custo de peça: fn_os_snapshot_custo_lucro somava erp_os_peca_solicitacao
--      (0 linhas nessas OS). As peças aprovadas de verdade estão em erp_os_diagnostico_item.
--      Confirmado seguro trocar: KGF tem 0 OS usando peca_solicitacao e 0 com custo_pecas_snapshot>0.
--   2) SEM DADO de custo: de 506 peças aprovadas, 503 são peça livre sem custo → custo DESCONHECIDO,
--      não zero. Gravar lucro=receita, margem=100% é mentira.
--
-- CAMPO PRÓPRIO (decisão do CEO): NÃO reusar snapshot_estimado ("o cálculo usou estimativa") para
-- dizer "custo desconhecido" — são coisas opostas. Colunas novas, aditivas:
--   custo_incompleto boolean  → o custo não é confiável (não calculei margem real)
--   motivo_custo     text     → 'sem_custo_peca' | 'sem_apontamento' | 'ambos' | NULL
-- snapshot_estimado volta ao seu significado original (o parâmetro p_estimado do cálculo), intocado.
--
-- Leitores confirmados (RD-38): nenhuma view lê estes campos. fn_manutencoes_relatorio só usa
-- custo_pecas/custo_mo (COALESCE 0). fn_oficina_entregues_listar SOMA receita_snapshot e lucro_snapshot
-- nos totais — como o lucro passa a ser NULL quando o custo é incompleto (com receita presente), a
-- soma o ignoraria em silêncio e o total deixaria de reconciliar com a receita. Por isso esta migration
-- também ensina o entregues_listar a expor qtd_custo_incompleto + custo_incompleto/motivo por linha,
-- para o total continuar honesto (o SUM ignora o NULL, e o contador explica o buraco — como já faz
-- qtd_aguardando para receita nula).

-- 1) colunas próprias (aditivo; DEFAULT constante = mudança de metadado, sem rewrite)
ALTER TABLE erp_os
  ADD COLUMN IF NOT EXISTS custo_incompleto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_custo text;

-- 2) snapshot: fonte certa de custo de peça + regra da verdade + campo próprio
CREATE OR REPLACE FUNCTION public.fn_os_snapshot_custo_lucro(p_os_id uuid, p_estimado boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_receita numeric; v_pecas numeric; v_horas numeric;
  v_ch jsonb; v_custo_hora numeric; v_mo numeric; v_lucro numeric; v_margem numeric;
  v_pecas_sem_custo int; v_servicos_aprovados int;
  v_falta_peca boolean; v_falta_mo boolean; v_custo_incompleto boolean; v_motivo text;
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

  -- custo incompleto: peça aprovada sem custo conhecido, e/ou serviço aprovado sem mão de obra apurada
  v_falta_peca := (v_pecas_sem_custo > 0);
  v_falta_mo   := (v_servicos_aprovados > 0 AND COALESCE(v_mo, 0) = 0);
  v_custo_incompleto := v_falta_peca OR v_falta_mo;
  v_motivo := CASE
    WHEN v_falta_peca AND v_falta_mo THEN 'ambos'
    WHEN v_falta_peca THEN 'sem_custo_peca'
    WHEN v_falta_mo   THEN 'sem_apontamento'
    ELSE NULL END;

  IF v_receita IS NULL THEN
    v_lucro := NULL; v_margem := NULL;                 -- ainda não faturou
  ELSIF v_custo_incompleto THEN
    v_lucro := NULL; v_margem := NULL;                 -- NUNCA margem inflada com custo desconhecido
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
    snapshot_estimado       = COALESCE(p_estimado, false),  -- significado original (cálculo estimado), intocado
    custo_incompleto        = v_custo_incompleto,           -- campo próprio: custo desconhecido
    motivo_custo            = v_motivo                       -- o que falta preencher
  WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'receita', v_receita, 'custo_pecas', ROUND(v_pecas, 2),
    'custo_mao_obra', ROUND(v_mo, 2), 'lucro', v_lucro, 'margem', v_margem,
    'custo_incompleto', v_custo_incompleto, 'motivo_custo', v_motivo, 'pecas_sem_custo', v_pecas_sem_custo,
    'aguardando_faturamento', (v_receita IS NULL));
END $function$;

-- 3) entregues_listar: expõe o novo estado por linha + conta no total, p/ o lucro somado
--    continuar reconciliando (o SUM ignora o lucro NULL; qtd_custo_incompleto explica o buraco).
CREATE OR REPLACE FUNCTION public.fn_oficina_entregues_listar(p_company_id uuid, p_data_ini date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_busca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_q text := NULLIF(trim(COALESCE(p_busca,'')), '');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH ent AS (
    SELECT o.id AS os_id, o.numero, o.entregue_em, o.cliente_nome, o.placa,
           NULLIF(trim(COALESCE(o.marca,'') || ' ' || COALESCE(o.modelo,'')), '') AS veiculo,
           COALESCE(NULLIF(trim(o.diagnostico), ''), NULLIF(trim(o.defeito_relatado), ''), '—') AS servico,
           o.tecnico_nome AS mecanico,
           COALESCE(o.custo_pecas_snapshot, 0) AS custo_pecas,
           COALESCE(o.custo_mao_obra_snapshot, 0) AS custo_mo,
           o.receita_snapshot AS receita, o.lucro_snapshot AS lucro,
           (o.receita_snapshot IS NULL) AS aguardando,
           o.custo_incompleto AS custo_incompleto, o.motivo_custo AS motivo_custo
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue' AND o.excluida_em IS NULL
      AND (p_data_ini IS NULL OR (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date >= p_data_ini)
      AND (p_data_fim IS NULL OR (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date <= p_data_fim)
      AND (v_q IS NULL OR o.placa ILIKE '%'||v_q||'%' OR o.cliente_nome ILIKE '%'||v_q||'%' OR o.numero::text ILIKE '%'||v_q||'%')
  )
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(ent) ORDER BY ent.entregue_em DESC NULLS LAST) FROM ent), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'custo_total', COALESCE(SUM(custo_pecas + custo_mo), 0),
        'custo_pecas', COALESCE(SUM(custo_pecas), 0),
        'custo_mo', COALESCE(SUM(custo_mo), 0),
        'receita', SUM(receita),
        'lucro', SUM(lucro),
        'qtd_aguardando', COUNT(*) FILTER (WHERE aguardando),
        'qtd_custo_incompleto', COUNT(*) FILTER (WHERE custo_incompleto)   -- lucro destes NÃO entra no SUM
      ) FROM ent)
  ) INTO v_res;
  RETURN v_res;
END $function$;
