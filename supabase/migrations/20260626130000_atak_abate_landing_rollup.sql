-- ============================================================
-- ATAK Abate Frioeste — landing raw (por cabeça) + rollup
-- Arquitetura B (CEO 26/06/2026): landing por cabeça + view rollup +
-- Edge Function de ingestão (atak-ingest) + coletor na rede Frioeste.
-- Aplicada via MCP em 2026-06-26 — versionada aqui pra cristalizar drift.
-- ============================================================

-- 1) Tabela landing raw: 1 linha = 1 cabeça abatida
CREATE TABLE IF NOT EXISTS public.ind_abate_atak (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  cod_filial          text NOT NULL,
  chave_fato          text NOT NULL,
  seq_cabeca          integer NOT NULL,
  num_lote            integer,
  data_abate          date NOT NULL,
  datahora_registro   timestamptz,
  cod_produto         text,
  desc_classificacao  text,
  cod_classif         integer,
  cod_precoce         text,
  cod_cobertura       text,
  cod_conformacao     text,
  cod_maturidade      text,
  tipificacao_ia      text,
  peso_carcaca1       numeric,
  peso_carcaca2       numeric,
  peso_carcaca_total  numeric GENERATED ALWAYS AS (COALESCE(peso_carcaca1,0)+COALESCE(peso_carcaca2,0)) STORED,
  arrobas             numeric GENERATED ALWAYS AS ((COALESCE(peso_carcaca1,0)+COALESCE(peso_carcaca2,0))/15.0) STORED,
  peso_carcaca1_resf  numeric,
  peso_carcaca2_resf  numeric,
  valor_arroba_pec    numeric,
  valor_arroba_nf     numeric,
  valor_arroba_tabela numeric,
  valor_arroba_calc   numeric,
  carne_magra         numeric,
  perc_carne_magra    numeric,
  esp_toucinho        numeric,
  id_sisbov           bigint,
  rastreabilidade     text,
  cod_camara          text,
  cod_manejo          text,
  raw                 jsonb,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ind_abate_atak UNIQUE (company_id, cod_filial, chave_fato, seq_cabeca)
);

CREATE INDEX IF NOT EXISTS ix_ind_abate_atak_comp_data ON public.ind_abate_atak (company_id, data_abate);
CREATE INDEX IF NOT EXISTS ix_ind_abate_atak_sisbov   ON public.ind_abate_atak (id_sisbov);

-- 2) RLS multi-tenant (leitura). Escrita só via service role (Edge).
ALTER TABLE public.ind_abate_atak ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ind_abate_atak_sel ON public.ind_abate_atak;
CREATE POLICY ind_abate_atak_sel ON public.ind_abate_atak
  FOR SELECT USING (is_admin() OR company_id IN (SELECT get_user_company_ids()));

-- 3) View rollup diário (security_invoker — herda RLS do usuário)
DROP VIEW IF EXISTS public.v_ind_abate_diario;
CREATE VIEW public.v_ind_abate_diario WITH (security_invoker=on) AS
SELECT
  company_id,
  cod_filial,
  data_abate,
  COUNT(*)::int                                 AS cabecas,
  ROUND(SUM(peso_carcaca_total), 2)             AS kg_carcaca_total,
  ROUND(AVG(peso_carcaca_total), 2)             AS peso_medio_kg,
  ROUND(SUM(arrobas), 2)                        AS arrobas_total,
  ROUND(AVG(NULLIF(valor_arroba_pec, 0)), 2)    AS arroba_media_pec
FROM public.ind_abate_atak
GROUP BY company_id, cod_filial, data_abate;

-- 4) Cadastro da planta Frioeste (idempotente)
INSERT INTO public.industrial_plants
  (company_id, nome_planta, codigo_planta, tipo_inspecao, especies, is_active)
SELECT
  '975365cc-9e5a-4251-9022-68c6bfde10d8',
  'Frigorífico Magia (Frioeste)',
  '100',
  'SIF',
  ARRAY['bovino'],
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.industrial_plants
  WHERE company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
    AND codigo_planta = '100'
);
