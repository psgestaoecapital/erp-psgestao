-- FEATURE-TAKEOFF-AMBIENTE-MANUAL (07/07 · Saneamento V1 Fase 3 · destravar
-- tela quebrada): quando o APS/IA nao extrai ambientes (DWG unitless ou toda
-- a geometria em blocos — ex. planta BLUE-2023-18 com candidatos_ambiente=[]),
-- a tabela de ambientes do Takeoff vinha VAZIA e o engenheiro ficava travado
-- (sem linha pra editar, sem botao pra adicionar). Esta RPC permite criar o
-- ambiente na mao.
--
-- Por que RPC dedicada (nao reusar fn_takeoff_ambientes_salvar):
-- aquela hardcoda origem='ia' e faz DELETE dos ambientes IA nao-confirmados no
-- inicio — um ambiente manual salvo por la viraria 'ia' e seria varrido na
-- proxima analise. Aqui: origem='manual' -> IMUNE ao DELETE de IA.
--
-- fn_takeoff_gerar_orcamento ja consome qualquer ambiente confirmado+servico_id
-- independente de origem, entao o manual gera orcamento igual ao IA.
--
-- Autoria: CEO (colado no Code Web, RD-41). Aplicada via MCP em 2026-07-07.

CREATE OR REPLACE FUNCTION fn_takeoff_ambiente_criar_manual(
  p_company_id     uuid,
  p_planta_id      uuid,
  p_nome           text,
  p_area_m2        numeric DEFAULT NULL,
  p_largura_m      numeric DEFAULT NULL,
  p_comprimento_m  numeric DEFAULT NULL,
  p_perimetro_ml   numeric DEFAULT NULL,
  p_pe_direito_m   numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid;
  v_area        numeric;
  v_perimetro   numeric;
BEGIN
  -- guard multi-tenant (P2): usuário só cria na própria empresa
  IF NOT EXISTS (
    SELECT 1 FROM erp_obra_planta pl
    WHERE pl.id = p_planta_id
      AND pl.company_id = p_company_id
      AND pl.company_id IN (SELECT get_user_company_ids())
  ) THEN
    RAISE EXCEPTION 'Planta não pertence à empresa do usuário';
  END IF;

  -- área: direta OU calculada de L×C
  v_area := COALESCE(
    p_area_m2,
    CASE WHEN p_largura_m IS NOT NULL AND p_comprimento_m IS NOT NULL
         THEN p_largura_m * p_comprimento_m END
  );

  -- perímetro: informado OU sugerido de L×C
  v_perimetro := COALESCE(
    p_perimetro_ml,
    CASE WHEN p_largura_m IS NOT NULL AND p_comprimento_m IS NOT NULL
         THEN 2 * (p_largura_m + p_comprimento_m) END
  );

  INSERT INTO erp_obra_planta_ambiente (
    company_id, planta_id, nome,
    largura_m, comprimento_m, area_m2, perimetro_ml, pe_direito_m,
    origem, confirmado, confianca
  ) VALUES (
    p_company_id, p_planta_id, COALESCE(NULLIF(trim(p_nome),''),'Ambiente'),
    p_largura_m, p_comprimento_m, v_area, v_perimetro, p_pe_direito_m,
    'manual', false, 'alta'          -- origem='manual' → imune ao DELETE de IA
  )
  RETURNING id INTO v_id;

  -- recalcular área total da planta (só ambientes vivos)
  UPDATE erp_obra_planta
  SET area_total_m2 = (
    SELECT COALESCE(SUM(area_m2),0)
    FROM erp_obra_planta_ambiente
    WHERE planta_id = p_planta_id
  )
  WHERE id = p_planta_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_takeoff_ambiente_criar_manual TO authenticated;
