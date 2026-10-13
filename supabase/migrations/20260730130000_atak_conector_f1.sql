-- ============================================================
-- CONECTOR ATAK GENÉRICO — F1 (config + mapa + landing universal + views + BI)
-- Diretriz CEO: o conector ATAK é PRODUTO reutilizável. Config de conexão e
-- de-para de tabelas viram DADO no banco (não código). Nova empresa ATAK
-- reusa o mapa GLOBAL (company_id NULL) e roda o coletor sozinha (F2).
--
-- Resiliência: a landing guarda o `raw` (linha inteira do ATAK); os campos
-- tipados saem de VIEWS que leem o raw. Errar um parse não perde dado —
-- ajusta a view, não recarrega.
--
-- Escopo F1 (Code Web aplica · RD-41): atak_conexao_config + atak_fonte_mapa +
--   ind_atak_fato + views embalagem/estoque + seed global (embalagem/estoque) +
--   linkagem BI (temas embalagens/camaras acendem sozinhos com dado real).
-- Fora do F1: extrator/coletor + carga real (F2); demais domínios do mapa (F3);
--   config do piloto Frioeste (F2 — depende de banco/usuário + segredo no Vault).
--
-- Reuso confirmado (RD-26): get_user_company_ids(), is_admin(),
--   fn_vault_ler_secret(p_name) [SECURITY DEFINER — leitura da senha no coletor F2].
-- Aplicada via MCP em 2026-07-30 — versionada aqui pra cristalizar drift.
-- ============================================================

-- ── 1.1 Conexão por empresa (credenciais no Vault; aqui só o nome do segredo) ──
CREATE TABLE IF NOT EXISTS public.atak_conexao_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL UNIQUE,
  host              text NOT NULL,              -- ex.: 192.168.20.77
  porta             int  NOT NULL DEFAULT 1433,
  banco             text NOT NULL,              -- nome do database ATAK
  cod_filial        text,                       -- ex.: 100
  usuario           text NOT NULL,              -- usuario_leitura
  vault_secret_name text NOT NULL,              -- nome do segredo no Vault (senha) — NUNCA texto
  sync_minuto       int DEFAULT 15,             -- agenda
  ativo             boolean DEFAULT true,
  criado_em         timestamptz DEFAULT now()
);

ALTER TABLE public.atak_conexao_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atak_conexao_config_read ON public.atak_conexao_config;
CREATE POLICY atak_conexao_config_read ON public.atak_conexao_config FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS atak_conexao_config_write_admin ON public.atak_conexao_config;
CREATE POLICY atak_conexao_config_write_admin ON public.atak_conexao_config FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- escrita normal via service_role (bypassa RLS) ou admin. Segredo (senha) só no Vault.

-- ── 1.2 De-para REUTILIZÁVEL (o mapa das tabelas). company_id NULL = GLOBAL ──
CREATE TABLE IF NOT EXISTS public.atak_fonte_mapa (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid,                        -- NULL = mapa GLOBAL (template p/ toda empresa ATAK)
  dominio          text NOT NULL,               -- embalagem|estoque|abate|desossa|...
  tabela_origem    text NOT NULL,               -- ex.: dbo.tbProduto
  chave_fato_sql   text NOT NULL,               -- expr p/ dedup (ex.: 'cod_produto')
  coluna_watermark text,                        -- coluna de data p/ incremental (NULL = 1ª vez full)
  colunas_parse    jsonb,                        -- {view_col: origem_col} p/ documentar a view
  ativo            boolean DEFAULT true,
  ordem            int DEFAULT 0
);
-- UNIQUE com COALESCE não é válido como constraint de tabela → índice único de expressão.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atak_fonte_mapa
  ON public.atak_fonte_mapa (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), dominio, tabela_origem);

ALTER TABLE public.atak_fonte_mapa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atak_fonte_mapa_read ON public.atak_fonte_mapa;
CREATE POLICY atak_fonte_mapa_read ON public.atak_fonte_mapa FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS atak_fonte_mapa_write_admin ON public.atak_fonte_mapa;
CREATE POLICY atak_fonte_mapa_write_admin ON public.atak_fonte_mapa FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 2. Landing UNIVERSAL (1 tabela p/ todos os domínios) ──
CREATE TABLE IF NOT EXISTS public.ind_atak_fato (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  cod_filial  text,
  dominio     text NOT NULL,                    -- embalagem|estoque|abate|...
  chave_fato  text NOT NULL,                    -- dedup dentro do domínio
  raw         jsonb NOT NULL,                   -- linha inteira do ATAK
  imported_at timestamptz DEFAULT now(),
  UNIQUE (company_id, dominio, chave_fato)
);
CREATE INDEX IF NOT EXISTS ix_atak_fato_cd ON public.ind_atak_fato (company_id, dominio);

ALTER TABLE public.ind_atak_fato ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atak_fato_read" ON public.ind_atak_fato;
CREATE POLICY "atak_fato_read" ON public.ind_atak_fato FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
-- escrita: service_role (o coletor) bypassa RLS. Sem grant p/ authenticated/anon.

-- ── 3. Consumo TIPADO por domínio (views que leem o raw · security_invoker) ──
-- security_invoker=on → a view herda a RLS de ind_atak_fato pro usuário logado.
DROP VIEW IF EXISTS public.v_ind_embalagem;
CREATE VIEW public.v_ind_embalagem WITH (security_invoker=on) AS
SELECT company_id, cod_filial, chave_fato AS cod_produto,
       raw->>'descricao' AS descricao, raw->>'ncm' AS ncm, raw->>'gtin' AS gtin, imported_at
FROM public.ind_atak_fato WHERE dominio='embalagem';

DROP VIEW IF EXISTS public.v_ind_estoque;
CREATE VIEW public.v_ind_estoque WITH (security_invoker=on) AS
SELECT company_id, cod_filial, raw->>'cod_produto' AS cod_produto,
       (raw->>'data')::date AS data_saldo, (raw->>'saldo')::numeric AS saldo, imported_at
FROM public.ind_atak_fato WHERE dominio='estoque';

GRANT SELECT ON public.v_ind_embalagem, public.v_ind_estoque TO authenticated;

-- ── 4. Seed do mapa GLOBAL (F1: só os domínios desta fase; demais = F3) ──
-- chave_fato_sql/coluna_watermark de cada domínio confirmam-se com SELECT TOP 5;
-- o `raw` garante que nada se perde antes disso. watermark NULL = 1ª carga full.
INSERT INTO public.atak_fonte_mapa (company_id, dominio, tabela_origem, chave_fato_sql, coluna_watermark, colunas_parse, ativo, ordem) VALUES
(NULL,'embalagem','dbo.tbProduto','cod_produto',NULL,
   '{"cod_produto":"chave_fato","descricao":"descricao","ncm":"ncm","gtin":"gtin"}'::jsonb,true,10),
(NULL,'estoque','dbo.tbProdutoSaldoDiario','cod_produto || ''|'' || data',NULL,
   '{"cod_produto":"cod_produto","data_saldo":"data","saldo":"saldo"}'::jsonb,true,20)
ON CONFLICT (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), dominio, tabela_origem) DO NOTHING;

-- ── 6. Linkagem BI: temas apontam p/ as views e acendem sozinhos com dado real ──
UPDATE public.ind_bi_tema SET fonte_tabela='v_ind_embalagem' WHERE codigo='embalagens';
UPDATE public.ind_bi_tema SET fonte_tabela='v_ind_estoque'   WHERE codigo='camaras';

-- Estende fn_bi_temas_industrial: conta os domínios ATAK (embalagem/estoque) na
-- landing p/ acender embalagens/camaras. Preserva 1:1 o comportamento existente
-- (producao/tipificacao/rendimentos via abate; rh via ponto) — só adiciona.
CREATE OR REPLACE FUNCTION public.fn_bi_temas_industrial(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_acesso boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_abate7 int := 0; v_ponto int := 0; v_emb int := 0; v_est int := 0;
  v_ab_fmt text; v_pt_fmt text; v_emb_fmt text; v_est_fmt text; v_out jsonb;
BEGIN
  IF v_acesso THEN
    SELECT count(*) INTO v_abate7 FROM public.ind_abate_atak
      WHERE company_id = p_company_id AND data_abate >= (now()::date - 7);
    SELECT count(*) INTO v_ponto FROM public.ind_ponto_dia WHERE company_id = p_company_id;
    SELECT count(*) INTO v_emb FROM public.ind_atak_fato WHERE company_id = p_company_id AND dominio = 'embalagem';
    SELECT count(*) INTO v_est FROM public.ind_atak_fato WHERE company_id = p_company_id AND dominio = 'estoque';
  END IF;
  v_ab_fmt  := regexp_replace(v_abate7::text, '(\d)(?=(\d{3})+$)', '\1.', 'g');
  v_pt_fmt  := regexp_replace(v_ponto::text,  '(\d)(?=(\d{3})+$)', '\1.', 'g');
  v_emb_fmt := regexp_replace(v_emb::text,    '(\d)(?=(\d{3})+$)', '\1.', 'g');
  v_est_fmt := regexp_replace(v_est::text,    '(\d)(?=(\d{3})+$)', '\1.', 'g');

  SELECT jsonb_agg(jsonb_build_object(
    'codigo', t.codigo, 'nome', t.nome, 'subtitulo', t.subtitulo, 'icone', t.icone,
    'secao', t.secao, 'ordem', t.ordem, 'rota_detalhe', t.rota_detalhe, 'destaque', t.destaque,
    'previsto', t.previsto,
    'tem_dado', CASE
      WHEN t.codigo IN ('producao','tipificacao','rendimentos') THEN (v_abate7 > 0)
      WHEN t.codigo = 'rh' THEN (v_ponto > 0)
      WHEN t.codigo = 'embalagens' THEN (v_emb > 0)
      WHEN t.codigo = 'camaras' THEN (v_est > 0)
      ELSE false END,
    'metrica', CASE
      WHEN t.codigo IN ('producao','tipificacao','rendimentos') AND v_abate7 > 0 THEN v_ab_fmt || ' cabeças · 7 dias'
      WHEN t.codigo = 'rh' AND v_ponto > 0 THEN v_pt_fmt || ' registros de ponto'
      WHEN t.codigo = 'embalagens' AND v_emb > 0 THEN v_emb_fmt || ' SKUs'
      WHEN t.codigo = 'camaras' AND v_est > 0 THEN v_est_fmt || ' posições de estoque'
      ELSE NULL END
  ) ORDER BY CASE t.secao WHEN 'entrada' THEN 1 WHEN 'abate' THEN 2 WHEN 'frio_desossa' THEN 3 WHEN 'saida' THEN 4 WHEN 'transversais' THEN 5 ELSE 9 END, t.ordem)
  INTO v_out
  FROM public.ind_bi_tema t WHERE t.ativo;

  RETURN COALESCE(v_out, '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_bi_temas_industrial(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_bi_temas_industrial(uuid) TO authenticated;
