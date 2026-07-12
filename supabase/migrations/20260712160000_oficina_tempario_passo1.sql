-- ============================================================
-- OFICINA · TEMPÁRIO — PASSO 1: modelo + RLS + parâmetros + menu.
--
-- O tempário é o catálogo de serviços da oficina (operação de mão de obra com
-- tempo-padrão). NÃO é o erp_servicos (catálogo FISCAL de NFS-e) — são coisas
-- distintas; conversam por FK opcional servico_fiscal_id (técnico na oficina,
-- fiscal em GE). ARQUITETURA: financeiro/fiscal é monopólio de GE.
--
-- PASSO 1 entrega o modelo + a tela premium de CRUD do catálogo + o card de
-- parâmetros. O motor de custo/preço/IA vem nos passos 2..7.
-- ============================================================

-- 1.1 — CATÁLOGO DE SERVIÇOS (o tempário) ------------------------------------
CREATE TABLE IF NOT EXISTS erp_oficina_servicos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  codigo           text,
  nome             text NOT NULL,
  categoria        text,                          -- mecanica|eletrica|suspensao|motor|freios|...
  tempo_padrao_h   numeric NOT NULL DEFAULT 0,    -- hora centesimal (1.5 = 1h30)
  origem_tempo     text NOT NULL DEFAULT 'manual' -- manual|ia_sugerido|ia_aprendido|importado
                     CHECK (origem_tempo IN ('manual','ia_sugerido','ia_aprendido','importado')),
  confianca_ia     int CHECK (confianca_ia IS NULL OR (confianca_ia BETWEEN 0 AND 100)),
  execucoes_conta  int NOT NULL DEFAULT 0,        -- nº de execuções que alimentaram o aprendizado
  aplica_veiculo   text,                          -- modelo/porte (tempo varia por carro)
  servico_fiscal_id uuid REFERENCES erp_servicos(id) ON DELETE SET NULL, -- FK opcional -> NFS-e
  ativo            boolean NOT NULL DEFAULT true,
  -- soft-delete (padrão CRUD)
  excluida         boolean NOT NULL DEFAULT false,
  excluida_em      timestamptz,
  excluida_por     uuid,
  excluida_motivo  text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid DEFAULT auth.uid(),
  alterado_em      timestamptz NOT NULL DEFAULT now(),
  alterado_por     uuid
);
CREATE INDEX IF NOT EXISTS idx_ofic_servicos_vivos
  ON erp_oficina_servicos (company_id, categoria) WHERE excluida = false;

-- 1.2 — HISTÓRICO DE EXECUÇÃO (alimenta a IA) --------------------------------
CREATE TABLE IF NOT EXISTS erp_oficina_servico_execucao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  servico_id       uuid NOT NULL REFERENCES erp_oficina_servicos(id) ON DELETE CASCADE,
  os_id            uuid,
  mecanico_id      uuid,
  tempo_previsto_h numeric,
  tempo_real_h     numeric,
  veiculo_modelo   text,
  executado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ofic_exec_servico ON erp_oficina_servico_execucao (servico_id);
CREATE INDEX IF NOT EXISTS idx_ofic_exec_company ON erp_oficina_servico_execucao (company_id);

-- 1.3 — PARÂMETROS DE CUSTO (o homem-hora) -----------------------------------
CREATE TABLE IF NOT EXISTS erp_oficina_parametros (
  company_id                uuid PRIMARY KEY,
  horas_produtivas_mes      numeric NOT NULL DEFAULT 160,
  margem_alvo_mao_obra_pct  numeric NOT NULL DEFAULT 30,
  margem_alvo_peca_pct      numeric NOT NULL DEFAULT 40,
  markup_teto_pct           numeric NOT NULL DEFAULT 100,
  markup_piso_pct           numeric NOT NULL DEFAULT 0,
  custo_hora_manual         numeric,               -- override opcional do calculado
  categorias_custo_fixo     text[] NOT NULL DEFAULT ARRAY['2.04.01','2.03.01','2.03.10','2.04.04','2.04.10','2.05.04']::text[],
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  alterado_em               timestamptz NOT NULL DEFAULT now()
);
-- Default custo-fixo (decisão CEO): Aluguel 2.04.01 · Salários 2.03.01 ·
-- Assistência Médica 2.03.10 · Energia 2.04.04 · Contabilidade 2.04.10 ·
-- Tarifas Bancárias 2.05.04. (DAS/Simples fica FORA — imposto s/ faturamento.)

-- RLS ------------------------------------------------------------------------
ALTER TABLE erp_oficina_servicos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_oficina_servico_execucao  ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_oficina_parametros        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ofic_servicos_all ON erp_oficina_servicos;
CREATE POLICY ofic_servicos_all ON erp_oficina_servicos FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS ofic_exec_all ON erp_oficina_servico_execucao;
CREATE POLICY ofic_exec_all ON erp_oficina_servico_execucao FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS ofic_param_all ON erp_oficina_parametros;
CREATE POLICY ofic_param_all ON erp_oficina_parametros FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Parâmetros default para empresas com plano oficina (KGF inclusa) -----------
INSERT INTO erp_oficina_parametros (company_id)
SELECT DISTINCT ts.company_id
FROM tenant_subscriptions ts
WHERE ts.status='active' AND ts.plan_id IN ('v15_oficina_pequena','v15_oficina_media','v15_oficina_grande')
ON CONFLICT (company_id) DO NOTHING;

-- MENU (espelha o Pátio) -----------------------------------------------------
INSERT INTO module_catalog (id, nome, rota, ativo, grupo, icone, layer, ordem, legacy, subgrupo, is_shared, diferencial, dependencies, surface_in_groups, vertical_specific)
VALUES ('oficina_tempario', 'Tempário', '/dashboard/oficina/tempario', true, 'oficina', '⏱️', '2_svc', 2, false, 'operacao', false, true, ARRAY[]::text[], ARRAY[]::text[], ARRAY['oficina']::text[])
ON CONFLICT (id) DO UPDATE SET ativo=true, rota=EXCLUDED.rota, nome=EXCLUDED.nome, legacy=false, diferencial=true, subgrupo=EXCLUDED.subgrupo;

INSERT INTO plan_modules (plan_id, module_id)
SELECT p, 'oficina_tempario' FROM unnest(ARRAY['v15_oficina_pequena','v15_oficina_media','v15_oficina_grande']) p
ON CONFLICT DO NOTHING;

INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES ('feat_oficina_tempario', 'oficina_tempario', 'oficina', 'Tempário',
        'Catálogo de serviços com tempo-padrão, custo homem-hora real de GE, matriz de margem e IA que aprende os tempos da própria oficina.',
        'em_construcao', 30, 'alta')
ON CONFLICT (id) DO UPDATE SET status='em_construcao', percentual_pronto=30;
