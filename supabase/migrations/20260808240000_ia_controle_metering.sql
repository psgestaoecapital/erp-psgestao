-- SPEC · Controle & Metering de IA por clínica (toggle liga/desliga · custo por company_id). RD-56/RD-41.
-- Genérico (todas as verticais). DEFAULT ON: ausência de linha = HABILITADO (só cria linha quem DESLIGA).
-- Base: aiGuardedCall + budget global (fn_budget_*). Teto global da PS continua por cima (segurança).

-- 1) Toggle por feature por empresa (default ON por ausência)
CREATE TABLE IF NOT EXISTS public.ia_config_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  feature text NOT NULL,          -- 'resumo_paciente' | 'consultor_clinica' | 'voz_soap' | ...
  habilitado boolean NOT NULL DEFAULT true,
  limite_diario_usd numeric,      -- teto por clínica/feature (NULL = sem teto próprio; global cobre)
  atualizado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, feature)
);

-- 2) Metering de IA por empresa (custo real por dia/feature)
CREATE TABLE IF NOT EXISTS public.ia_consumo_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  data_referencia date NOT NULL DEFAULT current_date,
  feature text NOT NULL,
  custo_usd numeric NOT NULL DEFAULT 0,
  chamadas int NOT NULL DEFAULT 0,
  UNIQUE (company_id, data_referencia, feature)
);
CREATE INDEX IF NOT EXISTS ix_ia_consumo_empresa_mes ON public.ia_consumo_empresa (company_id, data_referencia);

ALTER TABLE public.ia_config_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_consumo_empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pol_ia_config_sel ON public.ia_config_empresa;
CREATE POLICY pol_ia_config_sel ON public.ia_config_empresa FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS pol_ia_consumo_sel ON public.ia_consumo_empresa;
CREATE POLICY pol_ia_consumo_sel ON public.ia_consumo_empresa FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3a) pode gastar? (toggle da clínica + limite da clínica). Global (PS) é checado à parte por fn_budget_*.
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_pode_gastar(p_company_id uuid, p_feature text, p_custo_estimado numeric DEFAULT 0.01)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_hab boolean; v_lim numeric; v_cons numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'sem acesso'); END IF;
  SELECT habilitado, limite_diario_usd INTO v_hab, v_lim
    FROM ia_config_empresa WHERE company_id = p_company_id AND feature = p_feature;
  v_hab := coalesce(v_hab, true);   -- DEFAULT ON: ausência = ligado
  IF NOT v_hab THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'IA desativada para esta clínica'); END IF;
  v_cons := coalesce((SELECT custo_usd FROM ia_consumo_empresa WHERE company_id = p_company_id AND feature = p_feature AND data_referencia = current_date), 0);
  IF v_lim IS NOT NULL AND (v_cons + coalesce(p_custo_estimado,0)) > v_lim THEN
    RETURN jsonb_build_object('habilitado', true, 'pode', false, 'motivo', 'limite diário da clínica atingido', 'consumo_hoje', v_cons, 'limite', v_lim); END IF;
  RETURN jsonb_build_object('habilitado', true, 'pode', true, 'consumo_hoje', v_cons, 'limite', v_lim);
END $$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_pode_gastar(uuid,text,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_pode_gastar(uuid,text,numeric) TO authenticated;

-- 3b) registrar gasto por empresa/feature/dia
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_registrar_gasto(p_company_id uuid, p_feature text, p_custo_usd numeric, p_chamadas int DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  INSERT INTO ia_consumo_empresa (company_id, data_referencia, feature, custo_usd, chamadas)
  VALUES (p_company_id, current_date, p_feature, coalesce(p_custo_usd,0), coalesce(p_chamadas,1))
  ON CONFLICT (company_id, data_referencia, feature) DO UPDATE
    SET custo_usd = ia_consumo_empresa.custo_usd + coalesce(EXCLUDED.custo_usd,0),
        chamadas = ia_consumo_empresa.chamadas + coalesce(EXCLUDED.chamadas,1);
END $$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_registrar_gasto(uuid,text,numeric,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_registrar_gasto(uuid,text,numeric,int) TO authenticated;

-- 3c) ler config (só as linhas que existem — o front assume DEFAULT ON pro que faltar)
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_config(p_company_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'habilitado', habilitado, 'limite_diario_usd', limite_diario_usd)), '[]'::jsonb)
  FROM ia_config_empresa WHERE company_id = p_company_id AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin());
$$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_config(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_config(uuid) TO authenticated;

-- 3d) salvar toggle/limite de uma feature
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_config_salvar(p_company_id uuid, p_feature text, p_habilitado boolean, p_limite numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  INSERT INTO ia_config_empresa (company_id, feature, habilitado, limite_diario_usd, atualizado_por, atualizado_em)
  VALUES (p_company_id, p_feature, coalesce(p_habilitado, true), p_limite, auth.uid(), now())
  ON CONFLICT (company_id, feature) DO UPDATE
    SET habilitado = EXCLUDED.habilitado, limite_diario_usd = EXCLUDED.limite_diario_usd, atualizado_por = auth.uid(), atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_config_salvar(uuid,text,boolean,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_config_salvar(uuid,text,boolean,numeric) TO authenticated;

-- 3e) consumo do MÊS por feature (transparência na tela)
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_consumo_mes(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('total_usd', 0, 'chamadas', 0, 'por_feature', '{}'::jsonb); END IF;
  RETURN (SELECT jsonb_build_object(
      'total_usd', coalesce(sum(custo_usd), 0), 'chamadas', coalesce(sum(chamadas), 0),
      'por_feature', coalesce((SELECT jsonb_object_agg(feature, jsonb_build_object('custo_usd', c, 'chamadas', n)) FROM (
          SELECT feature, sum(custo_usd) c, sum(chamadas) n FROM ia_consumo_empresa
          WHERE company_id = p_company_id AND data_referencia >= date_trunc('month', now())::date GROUP BY feature) s), '{}'::jsonb))
    FROM ia_consumo_empresa WHERE company_id = p_company_id AND data_referencia >= date_trunc('month', now())::date);
END $$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_consumo_mes(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_consumo_mes(uuid) TO authenticated;
