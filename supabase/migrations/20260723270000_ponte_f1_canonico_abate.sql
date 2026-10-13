-- PS PONTE · FASE 1 — modelo canônico de abate + backfill dos 247 do ATAK.
-- RD-26 (âncoras auditadas), RD-30 (ind_abate_atak NÃO é apagada — só leitura),
-- RD-51 (NULL honesto, nunca zero), RD-55 (aditivo). F2/F3 fora de escopo.

-- ── TABELA 1 · ind_especie_perfil (referência; espécie por tabela, não por CHECK — TRAVA 4) ──
CREATE TABLE public.ind_especie_perfil (
  codigo                  text PRIMARY KEY,               -- 'bovino','suino','ave',...
  nome                    text NOT NULL,
  unidade_peso_padrao     text NOT NULL DEFAULT 'kg',
  usa_arroba              boolean NOT NULL DEFAULT false,  -- só bovino
  kg_por_arroba           numeric,                         -- 15 no bovino, NULL nos demais
  granularidade_padrao    text NOT NULL DEFAULT 'individual',
  atributos_classificacao jsonb NOT NULL DEFAULT '[]',     -- o que a TELA mostra por espécie
  ativo                   boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ind_especie_perfil
  (codigo,nome,usa_arroba,kg_por_arroba,granularidade_padrao,atributos_classificacao) VALUES
('bovino','Bovino', true, 15,'individual',
  '["tipificacao","maturidade","conformacao","acabamento","precoce","cobertura","rastreabilidade"]'),
('suino','Suíno',  false, NULL,'individual',
  '["espessura_toucinho","perc_carne_magra","classe"]'),
('ave','Ave',      false, NULL,'lote',
  '["categoria","condenacao_total","condenacao_parcial","peso_medio_ave"]');

-- catálogo (não é dado de cliente): SELECT liberado a autenticado
ALTER TABLE public.ind_especie_perfil ENABLE ROW LEVEL SECURITY;
CREATE POLICY especie_perfil_select ON public.ind_especie_perfil
  FOR SELECT TO authenticated USING (true);

-- ── TABELA 2 · ind_abate_evento (o canônico) ──
CREATE TABLE public.ind_abate_evento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  plant_id       uuid NOT NULL REFERENCES public.industrial_plants(id),
  especie        text NOT NULL REFERENCES public.ind_especie_perfil(codigo),   -- TRAVA 4
  data_abate     date NOT NULL,
  turno          text,
  granularidade  text NOT NULL CHECK (granularidade IN ('individual','lote')), -- domínio fechado
  cabecas        integer NOT NULL CHECK (cabecas > 0),
  lote_origem    text,
  sequencia      integer,
  identificacao  text,          -- SISBOV / brinco / lote. NULL em aves (TRAVA 3)
  peso_vivo_kg     numeric,     -- NULL quando a origem não fornece (TRAVA 2)
  peso_carcaca_kg  numeric,
  classificacao  jsonb,         -- específico da espécie; só chaves não-nulas
  valores        jsonb,         -- NULL quando ausente. NUNCA {"x":0} (TRAVA 2)
  fonte          text NOT NULL,          -- 'atak','datasul','arquivo',...
  chave_natural  text NOT NULL,          -- chave do evento NO SISTEMA DE ORIGEM
  raw_id         uuid,                   -- ligação com a landing raw (F2)
  hash_origem    text,
  ingerido_em    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_abate_evento_natural
    UNIQUE (company_id, plant_id, fonte, chave_natural)   -- TRAVA 1 (composta)
);

CREATE INDEX idx_abate_evento_cia_data ON public.ind_abate_evento (company_id, data_abate DESC);
CREATE INDEX idx_abate_evento_planta   ON public.ind_abate_evento (plant_id, data_abate DESC);
CREATE INDEX idx_abate_evento_especie  ON public.ind_abate_evento (company_id, especie, data_abate DESC);

ALTER TABLE public.ind_abate_evento ENABLE ROW LEVEL SECURITY;
CREATE POLICY abate_evento_select ON public.ind_abate_evento
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY abate_evento_insert ON public.ind_abate_evento
  FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY abate_evento_update ON public.ind_abate_evento
  FOR UPDATE USING (company_id IN (SELECT get_user_company_ids()));

-- Derivados NÃO são coluna: rendimento_pct, arrobas, peso_medio nascem do cálculo (lendo o perfil).

-- ── BACKFILL · os 247 do ATAK (idempotente; ind_abate_atak intacta) ──
INSERT INTO public.ind_abate_evento (
  company_id, plant_id, especie, data_abate, granularidade, cabecas,
  lote_origem, sequencia, identificacao,
  peso_vivo_kg, peso_carcaca_kg, classificacao, valores,
  fonte, chave_natural, hash_origem
)
SELECT
  a.company_id,
  p.id,
  'bovino',
  a.data_abate,
  'individual',
  1,                                  -- bovino individual = 1 cabeça
  a.num_lote::text,
  a.seq_cabeca,
  a.id_sisbov::text,                  -- TRAVA 3: atributo, não chave
  NULL,                               -- TRAVA 2: ATAK não tem peso vivo
  a.peso_carcaca_total,
  NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'tipificacao',        a.tipificacao_ia,
    'maturidade',         a.cod_maturidade,
    'conformacao',        a.cod_conformacao,
    'precoce',            a.cod_precoce,
    'cobertura',          a.cod_cobertura,
    'desc_classificacao', a.desc_classificacao,
    'cod_classif',        NULLIF(a.cod_classif, 0),
    'esp_toucinho',       a.esp_toucinho,
    'carne_magra',        a.carne_magra,
    'rastreabilidade',    a.rastreabilidade,
    'cod_produto',        a.cod_produto,
    'cod_camara',         a.cod_camara
  )), '{}'::jsonb),
  NULL,                               -- TRAVA 2: valor_arroba=0 é AUSENTE, não zero
  'atak',
  a.chave_fato || '-' || a.seq_cabeca,
  md5(a.chave_fato || '-' || a.seq_cabeca || '-' || coalesce(a.peso_carcaca_total::text,''))
FROM public.ind_abate_atak a
JOIN public.industrial_plants p
  ON p.company_id = a.company_id
 AND p.codigo_planta = a.cod_filial
ON CONFLICT ON CONSTRAINT uq_abate_evento_natural DO NOTHING;
