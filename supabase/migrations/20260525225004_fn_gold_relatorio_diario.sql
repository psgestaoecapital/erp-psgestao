-- AUDITORIA GOLD FASE 2 · RPC relatório diário (24h)
-- Aplicado via MCP apply_migration 25/05/2026 ~22:50 BRT
--
-- Será chamada por cron na FASE 5 (não criado aqui · scope lock RD-30).

CREATE OR REPLACE FUNCTION public.fn_gold_relatorio_diario()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total INT;
  v_ouro INT; v_prata INT; v_bronze INT; v_suspeito INT; v_bloqueado INT;
  v_custo_total NUMERIC;
  v_alertas_ec INT; v_alertas_ceo INT;
BEGIN
  SELECT COUNT(*),
    COUNT(*) FILTER (WHERE veredito_final = 'OURO'),
    COUNT(*) FILTER (WHERE veredito_final = 'PRATA'),
    COUNT(*) FILTER (WHERE veredito_final = 'BRONZE'),
    COUNT(*) FILTER (WHERE veredito_final = 'SUSPEITO'),
    COUNT(*) FILTER (WHERE veredito_final = 'BLOQUEADO'),
    COALESCE(SUM(custo_total_usd), 0),
    COUNT(*) FILTER (WHERE alertou_engenheiro_chefe),
    COUNT(*) FILTER (WHERE alertou_ceo)
  INTO v_total, v_ouro, v_prata, v_bronze, v_suspeito, v_bloqueado, v_custo_total, v_alertas_ec, v_alertas_ceo
  FROM gold_veredito_triplo
  WHERE executado_em > NOW() - INTERVAL '24 hours';

  RETURN jsonb_build_object(
    'periodo', '24 horas',
    'gerado_em', NOW(),
    'jornadas_executadas', v_total,
    'distribuicao', jsonb_build_object(
      'OURO', v_ouro, 'PRATA', v_prata, 'BRONZE', v_bronze,
      'SUSPEITO', v_suspeito, 'BLOQUEADO', v_bloqueado
    ),
    'custo_total_usd', v_custo_total,
    'alertas_engenheiro_chefe', v_alertas_ec,
    'alertas_ceo', v_alertas_ceo,
    'sistema_saudavel', (v_bloqueado = 0)
  );
END;
$$;
