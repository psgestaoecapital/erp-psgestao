-- BI Industrial · camada de acesso NEUTRA de produção (abate).
-- Diretriz do CEO: a UI lê CAMPOS NEUTROS (especie, plant_id, peso_carcaca, lote), nunca os nomes
-- crus do ATAK. Esta view é o ÚNICO ponto que conhece a origem — hoje ind_abate_atak, amanhã
-- ind_abate_evento (canônico) quando o backfill completar, SEM tocar a UI. (RD-52: uma fonte de verdade;
-- RD-55: aditivo; a v_ind_abate_diario passa a derivar DESTA view, não da tabela crua.)

CREATE OR REPLACE VIEW public.v_ind_producao_abate
WITH (security_invoker = on) AS   -- respeita a RLS multi-tenant de ind_abate_atak
SELECT
  a.company_id,
  pl.plant_id,
  a.cod_filial              AS codigo_planta,   -- compat (chave da planta na origem)
  'bovino'::text            AS especie,         -- atributo; multi-espécie entra aqui sem refatorar UI
  a.data_abate,
  a.datahora_registro,
  a.num_lote                AS lote,
  a.cod_camara              AS camara,
  a.seq_cabeca              AS sequencia,
  nullif(a.id_sisbov::text,'') AS identificacao,      -- SISBOV/brinco
  (a.id_sisbov IS NOT NULL)    AS tem_rastreio,
  a.peso_carcaca_total      AS peso_carcaca_kg,
  a.peso_carcaca1           AS meia_carcaca1_kg,
  a.peso_carcaca2           AS meia_carcaca2_kg,
  a.arrobas,
  a.valor_arroba_pec        AS valor_arroba,     -- vazio na origem hoje; mantém compat da diária
  a.cod_produto             AS produto,
  a.imported_at,
  'ind_abate_atak'::text    AS fonte
FROM public.ind_abate_atak a
LEFT JOIN LATERAL (
  SELECT p.id AS plant_id
  FROM public.industrial_plants p
  WHERE p.company_id = a.company_id AND p.codigo_planta = a.cod_filial
  LIMIT 1
) pl ON true;

GRANT SELECT ON public.v_ind_producao_abate TO authenticated;

-- Padroniza a diária existente: passa a derivar da camada neutra (mesma saída), não da tabela crua.
CREATE OR REPLACE VIEW public.v_ind_abate_diario
WITH (security_invoker = on) AS
SELECT
  company_id,
  codigo_planta AS cod_filial,
  data_abate,
  count(*)::integer                              AS cabecas,
  round(sum(peso_carcaca_kg), 2)                AS kg_carcaca_total,
  round(avg(peso_carcaca_kg), 2)                AS peso_medio_kg,
  round(sum(arrobas), 2)                        AS arrobas_total,
  round(avg(NULLIF(valor_arroba, 0::numeric)), 2) AS arroba_media_pec
FROM public.v_ind_producao_abate
GROUP BY company_id, codigo_planta, data_abate;
