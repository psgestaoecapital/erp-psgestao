-- PR 15 · DRE Drag-Drop Configurável (CEO 26/05/2026 · roadmap V1)
-- Aplicado via MCP apply_migration · rastreio histórico.
-- Persiste ordem personalizada das linhas (divisões) do DRE Divisional por empresa.

CREATE TABLE IF NOT EXISTS erp_dre_ordem_personalizada (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id),
  linha_id text not null,
  ordem int not null,
  visivel boolean default true,
  agrupador text,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_ordem_unique
  ON erp_dre_ordem_personalizada(company_id, linha_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_dre_ordem_company
  ON erp_dre_ordem_personalizada(company_id, ordem);

CREATE OR REPLACE FUNCTION fn_dre_ordem_personalizada_get(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'linha_id', linha_id,
      'ordem', ordem,
      'visivel', visivel,
      'agrupador', agrupador
    ) ORDER BY ordem
  ), '[]'::jsonb)
  FROM erp_dre_ordem_personalizada
  WHERE company_id = p_company_id
$$;

CREATE OR REPLACE FUNCTION fn_dre_ordem_personalizada_set(
  p_company_id uuid,
  p_ordens jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int := 0;
  item jsonb;
BEGIN
  DELETE FROM erp_dre_ordem_personalizada WHERE company_id = p_company_id;

  FOR item IN SELECT * FROM jsonb_array_elements(p_ordens)
  LOOP
    INSERT INTO erp_dre_ordem_personalizada (company_id, linha_id, ordem, visivel, agrupador)
    VALUES (
      p_company_id,
      item ->> 'linha_id',
      (item ->> 'ordem')::int,
      COALESCE((item ->> 'visivel')::boolean, true),
      item ->> 'agrupador'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION fn_dre_ordem_personalizada_reset(p_company_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM erp_dre_ordem_personalizada WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES (
  'F.financeiro.dre_drag_drop',
  'dre_divisional_modulo',
  'gestao_empresarial',
  'DRE Drag-Drop Configuravel · personalizacao premium',
  'Linhas do DRE Divisional podem ser reordenadas via drag-and-drop visual. Ordem persiste por empresa em erp_dre_ordem_personalizada. Botao reset volta ao default. Diferencial vs ContaAzul (DRE fixo) e Omie (limitado). PR 15.',
  'pronto',
  100,
  'alta'
)
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100, atualizado_em=NOW();

INSERT INTO screen_route_features (screen_id, feature_id, peso, visibilidade)
VALUES ('dashboard.dre_divisional', 'F.financeiro.dre_drag_drop', 2, 'primary')
ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION fn_dre_ordem_personalizada_get(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_dre_ordem_personalizada_set(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_dre_ordem_personalizada_reset(uuid) TO authenticated, service_role;
