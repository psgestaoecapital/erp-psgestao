-- Custo de logística (BrasilSat × ATAK × custos) — PR-2, fatia 1: tabela tratada de ENTREGAS
-- Épico despachado ao desenvolvedor_4_g (msg 360d5b82; mapa 'mapa-brasilsat'). CEO 27/11.
--
-- Transforma o ATAK cru (ind_atak_fato, dominio 'comercial_venda_item') numa tabela TIPADA de
-- entregas (nota -> carga -> caminhão), com colunas e índices prontos para o motor de custo (PR-3)
-- e o BI Comercial "Custo de logística" (PR-4). NUNCA se lê o JSON cru em tela: o parse é aqui, no sync.
--
-- Genérico (RD-96/ramo): o sync é um INSERT ... SELECT por FONTE. Hoje só o ramo ATAK (1 SELECT);
-- outro ERP entra como UNION ALL devolvendo as MESMAS colunas normalizadas (ver marcação FONTE).
--
-- Aditiva e idempotente: tabela nova, função nova. RLS por empresa, REVOKE anon, escrita só serviço.
-- Prova no dado (RD-38) — FRIOESTE 975365cc nov/26 (comercial_venda_item):
--   4604 itens (= 4604 chave_fato distintas) · 1710 notas · 132 cargas · 4386 com placa (95%)
--   · 13 placas · 12 casadas exato contra erp_hub_frota_veiculo (a 13ª é a divergência Mercosul/typo).

-- ========================================================================================
-- 1) Tabela tratada de entregas
-- ========================================================================================
CREATE TABLE IF NOT EXISTS public.log_entrega (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  origem        text NOT NULL DEFAULT 'atak',          -- FONTE do dado (ramo do ERP)
  fonte_chave   text NOT NULL,                         -- chave natural do item na fonte (ATAK: chave_fato) — dedup
  dia           date NOT NULL,                         -- ATAK: DATA_MOVTO
  num_carga     bigint,                                -- ATAK: NUM_CARGA
  serie_carga   text,                                  -- ATAK: SERIE_CARGA
  nota          text,                                  -- ATAK: NUM_DOCTO
  serie_nota    text,                                  -- ATAK: SERIE_SEQ
  item          integer,                               -- ATAK: NUM_ITEM
  cliente_cod   text,                                  -- ATAK: COD_CLI_FOR
  cliente       text,                                  -- ATAK: NOME_CADASTRO
  endereco      text,                                  -- ATAK: ENDERECO
  numero        text,                                  -- ATAK: NUMERO
  bairro        text,                                  -- ATAK: BAIRRO
  cep           text,                                  -- ATAK: CEP
  cidade        text,                                  -- ATAK: CIDADE
  uf            text,                                  -- ATAK: UF
  vendedor_cod  text,                                  -- ATAK: COD_VEND_COMP
  vendedor      text,                                  -- ATAK: NOME_COMP
  linha         text,                                  -- ATAK: DESC_DIVISAO (linha de produto)
  produto       text,                                  -- ATAK: DESC_PRODUTO_ROT
  kg            numeric,                               -- ATAK: PESO_LIQUIDO
  valor         numeric,                               -- ATAK: VALOR_TOTAL
  placa         text,                                  -- ATAK: PLACA1 (bruta)
  placa_norm    text,                                  -- placa só com A-Z0-9 maiúsculo
  veiculo_id    uuid REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE SET NULL,
  tipo          text NOT NULL DEFAULT 'propria',       -- 'propria' (tem placa) | 'sem_placa' (FOB/terceiro)
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT log_entrega_tipo_chk CHECK (tipo IN ('propria','sem_placa')),
  CONSTRAINT log_entrega_uq UNIQUE (company_id, origem, fonte_chave)
);

CREATE INDEX IF NOT EXISTS idx_log_entrega_dia      ON public.log_entrega (company_id, dia);
CREATE INDEX IF NOT EXISTS idx_log_entrega_veiculo  ON public.log_entrega (company_id, veiculo_id, dia);
CREATE INDEX IF NOT EXISTS idx_log_entrega_carga    ON public.log_entrega (company_id, num_carga);
CREATE INDEX IF NOT EXISTS idx_log_entrega_cliente  ON public.log_entrega (company_id, cliente_cod);
CREATE INDEX IF NOT EXISTS idx_log_entrega_vendedor ON public.log_entrega (company_id, vendedor_cod);
CREATE INDEX IF NOT EXISTS idx_log_entrega_placa    ON public.log_entrega (company_id, placa_norm);

-- RLS: leitura por empresa; escrita só serviço (o sync é SECURITY DEFINER).
ALTER TABLE public.log_entrega ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS log_entrega_ler ON public.log_entrega;
CREATE POLICY log_entrega_ler ON public.log_entrega
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.log_entrega FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.log_entrega FROM authenticated;
GRANT SELECT ON public.log_entrega TO authenticated;
GRANT ALL ON public.log_entrega TO service_role;

-- ========================================================================================
-- 2) Sync: parse do ATAK cru -> log_entrega (idempotente, por empresa)
-- ========================================================================================
-- ci-sem-guarda: fn_log_entrega_sync — só service_role (job diário / edge); sem EXECUTE para usuário.
CREATE OR REPLACE FUNCTION public.fn_log_entrega_sync(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatório';
  END IF;

  WITH fonte AS (
    -- ===== FONTE: ramo ATAK (1 SELECT). Outro ERP entra como UNION ALL com estas mesmas colunas. =====
    SELECT
      'atak'::text                                   AS origem,
      f.chave_fato                                   AS fonte_chave,
      (f.raw->>'DATA_MOVTO')::date                   AS dia,
      NULLIF(f.raw->>'NUM_CARGA','')::bigint          AS num_carga,
      NULLIF(f.raw->>'SERIE_CARGA','')                AS serie_carga,
      NULLIF(f.raw->>'NUM_DOCTO','')                  AS nota,
      NULLIF(f.raw->>'SERIE_SEQ','')                  AS serie_nota,
      NULLIF(f.raw->>'NUM_ITEM','')::integer           AS item,
      NULLIF(f.raw->>'COD_CLI_FOR','')                AS cliente_cod,
      NULLIF(f.raw->>'NOME_CADASTRO','')              AS cliente,
      NULLIF(f.raw->>'ENDERECO','')                   AS endereco,
      NULLIF(f.raw->>'NUMERO','')                     AS numero,
      NULLIF(f.raw->>'BAIRRO','')                     AS bairro,
      NULLIF(f.raw->>'CEP','')                        AS cep,
      NULLIF(f.raw->>'CIDADE','')                     AS cidade,
      NULLIF(f.raw->>'UF','')                         AS uf,
      NULLIF(f.raw->>'COD_VEND_COMP','')              AS vendedor_cod,
      NULLIF(f.raw->>'NOME_COMP','')                  AS vendedor,
      NULLIF(f.raw->>'DESC_DIVISAO','')               AS linha,
      NULLIF(f.raw->>'DESC_PRODUTO_ROT','')           AS produto,
      NULLIF(f.raw->>'PESO_LIQUIDO','')::numeric       AS kg,
      NULLIF(f.raw->>'VALOR_TOTAL','')::numeric        AS valor,
      NULLIF(f.raw->>'PLACA1','')                     AS placa,
      NULLIF(upper(regexp_replace(coalesce(f.raw->>'PLACA1',''),'[^A-Za-z0-9]','','g')),'') AS placa_norm
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id
      AND f.dominio = 'comercial_venda_item'
      AND f.chave_fato IS NOT NULL
      AND (f.raw->>'DATA_MOVTO') IS NOT NULL
  ),
  casada AS (
    -- veiculo_id por subconsulta escalar (LIMIT 1): uma linha por item mesmo que a placa
    -- apareça em mais de um veículo do cadastro (evita fan-out e erro no ON CONFLICT).
    SELECT fo.*,
           CASE WHEN fo.placa_norm IS NULL THEN NULL ELSE (
             SELECT v.id FROM public.erp_hub_frota_veiculo v
             WHERE v.company_id = p_company_id
               AND v.excluido_em IS NULL
               AND upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g')) = fo.placa_norm
             ORDER BY coalesce(v.ativo, true) DESC, v.criado_em
             LIMIT 1
           ) END AS veiculo_id,
           CASE WHEN fo.placa_norm IS NULL THEN 'sem_placa' ELSE 'propria' END AS tipo
    FROM fonte fo
  ),
  ins AS (
    INSERT INTO public.log_entrega AS le (
      company_id, origem, fonte_chave, dia, num_carga, serie_carga, nota, serie_nota, item,
      cliente_cod, cliente, endereco, numero, bairro, cep, cidade, uf, vendedor_cod, vendedor,
      linha, produto, kg, valor, placa, placa_norm, veiculo_id, tipo, atualizado_em
    )
    SELECT
      p_company_id, c.origem, c.fonte_chave, c.dia, c.num_carga, c.serie_carga, c.nota, c.serie_nota, c.item,
      c.cliente_cod, c.cliente, c.endereco, c.numero, c.bairro, c.cep, c.cidade, c.uf, c.vendedor_cod, c.vendedor,
      c.linha, c.produto, c.kg, c.valor, c.placa, c.placa_norm, c.veiculo_id, c.tipo, now()
    FROM casada c
    ON CONFLICT (company_id, origem, fonte_chave) DO UPDATE SET
      dia = EXCLUDED.dia, num_carga = EXCLUDED.num_carga, serie_carga = EXCLUDED.serie_carga,
      nota = EXCLUDED.nota, serie_nota = EXCLUDED.serie_nota, item = EXCLUDED.item,
      cliente_cod = EXCLUDED.cliente_cod, cliente = EXCLUDED.cliente, endereco = EXCLUDED.endereco,
      numero = EXCLUDED.numero, bairro = EXCLUDED.bairro, cep = EXCLUDED.cep, cidade = EXCLUDED.cidade,
      uf = EXCLUDED.uf, vendedor_cod = EXCLUDED.vendedor_cod, vendedor = EXCLUDED.vendedor,
      linha = EXCLUDED.linha, produto = EXCLUDED.produto, kg = EXCLUDED.kg, valor = EXCLUDED.valor,
      placa = EXCLUDED.placa, placa_norm = EXCLUDED.placa_norm, veiculo_id = EXCLUDED.veiculo_id,
      tipo = EXCLUDED.tipo, atualizado_em = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.fn_log_entrega_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_entrega_sync(uuid) TO service_role;

COMMENT ON TABLE public.log_entrega IS
  'Entregas tratadas (nota->carga->caminhão) para o custo de logística. Parse no sync (fn_log_entrega_sync), nunca JSON cru em tela. Mapa: mapa-brasilsat, PR-2.';
