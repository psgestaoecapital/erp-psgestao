-- ============================================================
-- ① Ramo de OBRA no template gerencial GLOBAL (por NATUREZA) — Opção A do CEO
-- ============================================================
-- O template global (company_id IS NULL) não cobre custo de obra. Como há 5 empresas de construção
-- no sistema, o ramo entra no PADRÃO GLOBAL (não só na FC), por NATUREZA (materiais/pessoal/veículos/
-- subempreitada/medições), sob o nó "2 CUSTOS", grupo/tipo 'custo' (minúsculo — casa com o DRE, que
-- roteia por tipo e psgc_depara, nunca pela string do grupo).
-- O tipo de serviço (pisos/gesso/pintura/litoral) NÃO vira conta — mora em erp_centros_custo.
-- Aditivo: só INSERE contas globais novas; não altera nenhuma empresa aqui (a FC é povoada no 290000).

-- 6 contas globais: 2.04 (sintética) + 5 naturezas (analíticas de lançamento)
INSERT INTO public.erp_plano_contas (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
SELECT NULL, t.codigo, t.descricao, 'custo', 'custo', t.pai, t.nivel, true, t.tot, false
FROM (VALUES
  ('2.04',    'Custo de Obras / Serviços de Construção',        '2',    2, true),
  ('2.04.01', 'Materiais Aplicados em Obra',                    '2.04', 3, false),
  ('2.04.02', 'Mão de Obra de Obra',                            '2.04', 3, false),
  ('2.04.03', 'Veículos e Equipamentos de Obra',                '2.04', 3, false),
  ('2.04.04', 'Subempreitada (Serviços de Obra Terceirizados)', '2.04', 3, false),
  ('2.04.05', 'Medições de Obra',                               '2.04', 3, false)
) AS t(codigo, descricao, pai, nivel, tot)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_plano_contas e WHERE e.company_id IS NULL AND e.codigo = t.codigo
);

-- ------------------------------------------------------------
-- Aplicar o template GLOBAL a uma empresa (copia as contas globais como contas próprias).
-- Idempotente (não duplica). Usado no go-live de uma empresa (ex.: FC) e pela tela no futuro.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_contas_aplicar_template_global(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_ins int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  INSERT INTO public.erp_plano_contas
    (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
  SELECT p_company_id, g.codigo, g.descricao, g.grupo, g.tipo, g.pai_codigo, g.nivel, true, g.is_totalizador, false
  FROM public.erp_plano_contas g
  WHERE g.company_id IS NULL AND g.ativo
    AND NOT EXISTS (
      SELECT 1 FROM public.erp_plano_contas e
      WHERE e.company_id = p_company_id AND e.codigo = g.codigo
    );
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'inseridas', v_ins,
    'total_empresa', (SELECT count(*) FROM public.erp_plano_contas WHERE company_id = p_company_id));
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_aplicar_template_global(uuid) TO authenticated;
