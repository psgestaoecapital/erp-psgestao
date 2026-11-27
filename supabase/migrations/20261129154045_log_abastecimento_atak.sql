-- Custo de logística (BrasilSat × ATAK × custos) — PR-2, fatia 2: tabela tratada de ABASTECIMENTO
-- Épico 'mapa-brasilsat' (msg 360d5b82, CEO 27/11). Base do custo R$/km e km/L por caminhão (PR-3/PR-4).
--
-- Fonte (ATAK): NF de entrada no domínio 'compra_gado', COD_TIPO_MV T130/T132, produto DIESEL/GASOLINA/ARLA,
-- QTDE_PRI = litros. A placa, o hodômetro (KM) e às vezes o motorista vêm no texto livre OBSERVACAO
-- ("PLACA: XXX", "KM:/QUILOMETRAGEM: n", "MOTORISTA: nome"), em vários formatos (com e sem pontos/espaço).
-- Nunca JSON cru em tela: o parse (regex) é aqui, no sync.
--
-- Casamento placa×caminhão: 1) exato pela placa normalizada; 2) tolerância de 1 caractere (cobre typo
-- digitado e antiga↔Mercosul, ex. MKS1306=MKS1D06) SÓ quando houver UM único candidato no cadastro.
--
-- Aditiva e idempotente (upsert por chave_fato). RLS por empresa, REVOKE anon, escrita só serviço.
-- Prova no dado (RD-38) — FRIOESTE out/26 (compra_gado, diesel/gasolina/arla, T130/T132):
--   171 abastecimentos · 15.603 L · 160 com placa (93%) · 153 com KM · 9 com motorista
--   · casamento: 139 exato + 6 por tolerância de 1 char (único) = 145 casados; o resto fica nulo (terceiro).

-- ========================================================================================
-- 1) Tabela tratada de abastecimentos
-- ========================================================================================
CREATE TABLE IF NOT EXISTS public.log_abastecimento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  origem         text NOT NULL DEFAULT 'atak',
  fonte_chave    text NOT NULL,                        -- chave_fato da NF de entrada (dedup)
  dia            date NOT NULL,                         -- DATA_MOVTO
  posto          text,                                  -- NOME_CADASTRO (fornecedor)
  produto        text,                                  -- DESC_PRODUTO_ROT/NF (DIESEL S10, GASOLINA, ARLA…)
  litros         numeric,                               -- QTDE_PRI
  valor          numeric,                               -- VALOR_TOTAL
  placa          text,                                  -- placa lida do OBSERVACAO (bruta)
  placa_norm     text,                                  -- placa só com A-Z0-9 maiúsculo
  veiculo_id     uuid REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE SET NULL,
  casamento      text,                                  -- NULL | 'exato' | 'tolerancia1'
  km_hodometro   numeric,                               -- KM/QUILOMETRAGEM do OBSERVACAO (hodômetro do caminhão)
  motorista_texto text,                                 -- MOTORISTA do OBSERVACAO (LGPD: só serviço/empresa)
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT log_abastecimento_uq UNIQUE (company_id, origem, fonte_chave)
);

CREATE INDEX IF NOT EXISTS idx_log_abast_dia     ON public.log_abastecimento (company_id, dia);
CREATE INDEX IF NOT EXISTS idx_log_abast_veiculo ON public.log_abastecimento (company_id, veiculo_id, dia);
CREATE INDEX IF NOT EXISTS idx_log_abast_placa   ON public.log_abastecimento (company_id, placa_norm);

ALTER TABLE public.log_abastecimento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS log_abastecimento_ler ON public.log_abastecimento;
CREATE POLICY log_abastecimento_ler ON public.log_abastecimento
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.log_abastecimento FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.log_abastecimento FROM authenticated;
GRANT SELECT ON public.log_abastecimento TO authenticated;
GRANT ALL ON public.log_abastecimento TO service_role;

-- ========================================================================================
-- 2) Sync: parse do ATAK cru -> log_abastecimento (idempotente, por empresa)
-- ========================================================================================
-- ci-sem-guarda: fn_log_abastecimento_sync — só service_role (job diário / edge); sem EXECUTE para usuário.
CREATE OR REPLACE FUNCTION public.fn_log_abastecimento_sync(p_company_id uuid)
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
      'atak'::text                                     AS origem,
      f.chave_fato                                     AS fonte_chave,
      (f.raw->>'DATA_MOVTO')::date                     AS dia,
      NULLIF(f.raw->>'NOME_CADASTRO','')               AS posto,
      coalesce(NULLIF(f.raw->>'DESC_PRODUTO_ROT',''), NULLIF(f.raw->>'DESC_PRODUTO_NF','')) AS produto,
      NULLIF(f.raw->>'QTDE_PRI','')::numeric            AS litros,
      NULLIF(f.raw->>'VALOR_TOTAL','')::numeric         AS valor,
      NULLIF(substring(upper(coalesce(f.raw->>'OBSERVACAO','')) from 'PLACA[^A-Z0-9]*([A-Z0-9]{7})'),'') AS placa,
      NULLIF(upper(regexp_replace(coalesce(substring(upper(coalesce(f.raw->>'OBSERVACAO','')) from 'PLACA[^A-Z0-9]*([A-Z0-9]{7})'),''),'[^A-Z0-9]','','g')),'') AS placa_norm,
      NULLIF(substring(upper(coalesce(f.raw->>'OBSERVACAO','')) from '(?:QUILOMETRAGEM|KM)\s*[.:]+\s*([0-9]{3,})'),'')::numeric AS km_hodometro,
      btrim(substring(coalesce(f.raw->>'OBSERVACAO','') from 'MOTORISTA\s*[.:]+\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,40})')) AS motorista_texto
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id
      AND f.dominio = 'compra_gado'
      AND f.chave_fato IS NOT NULL
      AND (f.raw->>'DATA_MOVTO') IS NOT NULL
      AND f.raw->>'COD_TIPO_MV' IN ('T130','T132')
      AND (upper(coalesce(f.raw->>'DESC_PRODUTO_ROT','')) ~ 'DIESEL|GASOLINA|ARLA'
        OR upper(coalesce(f.raw->>'DESC_PRODUTO_NF','')) ~ 'DIESEL|GASOLINA|ARLA')
  ),
  casada AS (
    SELECT fo.*,
      -- 1) exato; 2) tolerância de 1 caractere SÓ com candidato único (evita casar placas diferentes)
      coalesce(
        (SELECT v.id FROM public.erp_hub_frota_veiculo v
          WHERE v.company_id = p_company_id AND v.excluido_em IS NULL
            AND upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g')) = fo.placa_norm
          ORDER BY coalesce(v.ativo, true) DESC, v.criado_em LIMIT 1),
        (SELECT CASE WHEN count(*) = 1 THEN min(v.id) END
           FROM public.erp_hub_frota_veiculo v
          WHERE v.company_id = p_company_id AND v.excluido_em IS NULL
            AND fo.placa_norm IS NOT NULL
            AND length(upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g'))) = length(fo.placa_norm)
            AND (SELECT count(*) FROM generate_series(1, length(fo.placa_norm)) g
                  WHERE substr(upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g')), g, 1) <> substr(fo.placa_norm, g, 1)) <= 1)
      ) AS veiculo_id,
      CASE
        WHEN fo.placa_norm IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM public.erp_hub_frota_veiculo v
                      WHERE v.company_id = p_company_id AND v.excluido_em IS NULL
                        AND upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g')) = fo.placa_norm) THEN 'exato'
        WHEN (SELECT count(*) FROM public.erp_hub_frota_veiculo v
                WHERE v.company_id = p_company_id AND v.excluido_em IS NULL
                  AND length(upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g'))) = length(fo.placa_norm)
                  AND (SELECT count(*) FROM generate_series(1, length(fo.placa_norm)) g
                        WHERE substr(upper(regexp_replace(coalesce(v.placa,''),'[^A-Za-z0-9]','','g')), g, 1) <> substr(fo.placa_norm, g, 1)) <= 1) = 1 THEN 'tolerancia1'
        ELSE NULL
      END AS casamento
    FROM fonte fo
  ),
  ins AS (
    INSERT INTO public.log_abastecimento AS la (
      company_id, origem, fonte_chave, dia, posto, produto, litros, valor,
      placa, placa_norm, veiculo_id, casamento, km_hodometro, motorista_texto, atualizado_em
    )
    SELECT
      p_company_id, c.origem, c.fonte_chave, c.dia, c.posto, c.produto, c.litros, c.valor,
      c.placa, c.placa_norm, c.veiculo_id, c.casamento, c.km_hodometro,
      NULLIF(c.motorista_texto,''), now()
    FROM casada c
    ON CONFLICT (company_id, origem, fonte_chave) DO UPDATE SET
      dia = EXCLUDED.dia, posto = EXCLUDED.posto, produto = EXCLUDED.produto, litros = EXCLUDED.litros,
      valor = EXCLUDED.valor, placa = EXCLUDED.placa, placa_norm = EXCLUDED.placa_norm,
      veiculo_id = EXCLUDED.veiculo_id, casamento = EXCLUDED.casamento, km_hodometro = EXCLUDED.km_hodometro,
      motorista_texto = EXCLUDED.motorista_texto, atualizado_em = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.fn_log_abastecimento_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_abastecimento_sync(uuid) TO service_role;

COMMENT ON TABLE public.log_abastecimento IS
  'Abastecimentos tratados (NF de entrada compra_gado → litros/R$/km/placa/motorista). Parse no sync (fn_log_abastecimento_sync), nunca JSON cru em tela. Mapa: mapa-brasilsat, PR-2.';
