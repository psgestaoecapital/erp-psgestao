-- Hub · Insumos (DEMO Construtora 006) — fecha os gaps do auditor PDCA de 26/10 na tela
-- /dashboard/projetos/insumos: "sem vínculo com produto do estoque GE" e "indicador de variação de preço vazio".
--
-- Diagnóstico (RD-38, provado no dado): o CÓDIGO da tela já está completo (Ligar ao estoque, coluna Variação,
-- filtro Origem e "?" RD-95 em tudo). O que faltava era DADO na demo: os 17 insumos da 006 tinham
-- 0 vínculos em hub_insumo_produto e last_cost = current_cost (variação sempre 0 -> coluna mostrava "—").
-- Resultado: o auditor logava, via as colunas "Estoque (GE)" e "Variação" vazias e marcava dado_bate=false.
--
-- Esta migration é ADITIVA e só mexe na empresa de demonstração fixa do Hub (is_demo). Não toca empresa real,
-- não altera RLS/permissão, não mexe em cálculo de BOM/serviço (last_cost é só informativo para a coluna Variação).
-- Função idempotente: só liga insumo sem vínculo ativo e só semeia last_cost em linha demo ainda intocada.
-- Plano de volta: tirar a linha PERFORM do bloco DO abaixo (os dados da demo são recriados pelo seed).

-- ci-sem-guarda: fn_demo_hub_insumo_estoque_vinculo — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo seed da demo (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_hub_insumo_estoque_vinculo(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_vinc int := 0;
  v_var  int := 0;
  r record;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- 1) Liga os insumos de drywall ao produto equivalente do estoque do GE (erp_produtos), por par explícito de código.
  --    Idempotente: só liga insumo que ainda não tem vínculo ativo (respeita o índice único parcial por insumo).
  FOR r IN
    SELECT i.id AS insumo_id, p.id AS produto_id
    FROM (VALUES
      ('DEMO-I01', 'DEMO-CALC-CHAPA'),     -- Placa de gesso acartonado ST  -> Chapa de gesso standard 12,5 mm
      ('DEMO-I02', 'DEMO-CALC-MONTANTE'),  -- Perfil montante 48mm          -> Montante 48 mm (barra 3 m)
      ('DEMO-I03', 'DEMO-CALC-GUIA'),      -- Perfil guia 48mm              -> Guia 48 mm (barra 3 m)
      ('DEMO-I04', 'DEMO-CALC-PARAFUSO'),  -- Parafuso GN25 (cento)         -> Parafuso PPA25 (cento)
      ('DEMO-I05', 'DEMO-CALC-MASSA'),     -- Massa para junta (balde 5kg)  -> Massa para junta (balde 5 kg)
      ('DEMO-I06', 'DEMO-CALC-FITA')       -- Fita telada                   -> Fita para junta (rolo)
    ) AS m(ins_code, prod_code)
    JOIN m16_insumos i  ON i.company_id = c AND i.erp_code = m.ins_code
    JOIN erp_produtos p ON p.company_id = c AND p.codigo  = m.prod_code AND p.ativo IS NOT FALSE
    WHERE NOT EXISTS (SELECT 1 FROM hub_insumo_produto h WHERE h.insumo_id = i.id AND h.ativo)
  LOOP
    INSERT INTO hub_insumo_produto (company_id, insumo_id, produto_id, usar_maior_custo)
    VALUES (c, r.insumo_id, r.produto_id, false);
    v_vinc := v_vinc + 1;
  END LOOP;

  -- 2) Semente de variação de preço: define um custo anterior (last_cost) plausível e diferente do atual,
  --    para a coluna "Variação" sair do vazio (mostra ↑/↓). Mistura altas e quedas, realista para um catálogo.
  --    Idempotente: só toca a linha demo ainda intocada (last_cost = current_cost).
  WITH prev(code, ant) AS (VALUES
    ('DEMO-I01',     36.00::numeric),  -- 36,00 -> 38,50  = +6,9%
    ('DEMO-I05',     25.50::numeric),  -- 25,50 -> 27,00  = +5,9%
    ('DEMO-I07',     58.00::numeric),  -- 58,00 -> 54,00  = -6,9%
    ('DEMO-I08',     29.50::numeric),  -- 29,50 -> 31,00  = +5,1%
    ('DEMO-I10',    275.00::numeric),  -- 275,00 -> 289,00 = +5,1%
    ('DEMO-FC-I02',   8.40::numeric),  -- 8,40 -> 7,90    = -6,0%
    ('DEMO-FC-I06', 245.00::numeric)   -- 245,00 -> 260,00 = +6,1%
  )
  UPDATE m16_insumos i SET last_cost = prev.ant
  FROM prev
  WHERE i.company_id = c
    AND i.erp_code = prev.code
    AND i.current_cost IS NOT NULL
    AND i.last_cost IS NOT DISTINCT FROM i.current_cost;
  GET DIAGNOSTICS v_var = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'vinculos_novos', v_vinc, 'variacao_semeada', v_var);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_hub_insumo_estoque_vinculo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_hub_insumo_estoque_vinculo(uuid) TO service_role;

-- aplica agora (só se a demo existir neste banco)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_hub_insumo_estoque_vinculo('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
