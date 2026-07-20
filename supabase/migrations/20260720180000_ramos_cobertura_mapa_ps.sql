-- MAPA DE COBERTURA POR RAMO (equipe PS · interno). RD-51: mede telas ENTREGUES (pronto E ativo) vs.
-- TAGUEADAS por ramo, com o dado que existe. NÃO inventa alvo: ramo sem tela específica = 0/0 (verdade modesta),
-- nunca uma % fantasia. Tela pronta porém INATIVA não conta como entregue (evita 100% fantasma).
-- Escopo industrial (grupo industrial ou compartilhado). Guard PS_ADMIN. Só leitura, aditivo.
-- Reverter: DROP das 2 funções.

-- 1 · resumo por ramo (vocab controlado) + linha (comuns).
CREATE OR REPLACE FUNCTION public.fn_ramos_cobertura()
RETURNS TABLE(ramo text, is_comuns boolean, total int, prontas int, faltam int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_vocab text[] := ARRAY['bovinos','suinos','aves','pescado','laticinios','panificacao','embutidos',
  'conservas','bebidas','racao','graos','madeira','quimica','plasticos','metalmecanica','moveis','texteis'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id=auth.uid() AND u.system_role='PS_ADMIN') THEN
    RAISE EXCEPTION 'Mapa de cobertura é interno da equipe PS.';
  END IF;
  RETURN QUERY
  WITH ind AS (
    SELECT mc.id, mc.ramos_aplicaveis, mc.ativo,
           (COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id=mc.id LIMIT 1),'previsto')='pronto'
            AND mc.ativo) AS entregue
    FROM module_catalog mc
    WHERE mc.legacy=false
      AND (mc.grupo='industrial' OR 'industrial'=ANY(coalesce(mc.surface_in_groups,'{}')))
  )
  SELECT '(comuns)'::text, true,
         count(*) FILTER (WHERE ramos_aplicaveis IS NULL OR cardinality(ramos_aplicaveis)=0)::int,
         count(*) FILTER (WHERE (ramos_aplicaveis IS NULL OR cardinality(ramos_aplicaveis)=0) AND entregue)::int,
         count(*) FILTER (WHERE (ramos_aplicaveis IS NULL OR cardinality(ramos_aplicaveis)=0) AND NOT entregue)::int
  FROM ind
  UNION ALL
  SELECT r, false,
         (SELECT count(*) FROM ind WHERE ind.ramos_aplicaveis @> ARRAY[r])::int,
         (SELECT count(*) FROM ind WHERE ind.ramos_aplicaveis @> ARRAY[r] AND ind.entregue)::int,
         (SELECT count(*) FROM ind WHERE ind.ramos_aplicaveis @> ARRAY[r] AND NOT ind.entregue)::int
  FROM unnest(v_vocab) r
  ORDER BY 2 DESC, 3 DESC, 1;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_ramos_cobertura() TO authenticated;

-- 2 · detalhe: cada tela classificada (o "badge" do PS — quais telas são de qual ramo, e se estão prontas/ativas).
CREATE OR REPLACE FUNCTION public.fn_ramos_cobertura_modulos()
RETURNS TABLE(modulo_id text, nome text, ramos text[], status text, ativo boolean, comum boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id=auth.uid() AND u.system_role='PS_ADMIN') THEN
    RAISE EXCEPTION 'Mapa de cobertura é interno da equipe PS.';
  END IF;
  RETURN QUERY
  SELECT mc.id, mc.nome, mc.ramos_aplicaveis,
         COALESCE((SELECT fc.status FROM feature_catalog fc WHERE fc.module_id=mc.id LIMIT 1),'previsto'),
         mc.ativo,
         (mc.ramos_aplicaveis IS NULL OR cardinality(mc.ramos_aplicaveis)=0)
  FROM module_catalog mc
  WHERE mc.legacy=false
    AND (mc.grupo='industrial' OR 'industrial'=ANY(coalesce(mc.surface_in_groups,'{}')))
  ORDER BY (mc.ramos_aplicaveis IS NULL OR cardinality(mc.ramos_aplicaveis)=0), mc.nome;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_ramos_cobertura_modulos() TO authenticated;
