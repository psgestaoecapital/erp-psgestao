-- BI Comercial · Painel da Franciele (CEO 09/11) — PERFORMANCE: o painel não abria (timeout).
-- Causa provada no dado (RD-38): fn_com_venda_item relê e reparsa ~20 campos JSONB de ind_atak_fato a CADA
-- chamada (6.285 itens ≈ 1.270 ms/chamada), e fn_bi_comercial_painel a chama 3× (período atual, período anterior,
-- 12 meses) + agregações → > 15 s. A view materializada bi_comercial_item_mv já existe para o resto das abas, mas
-- usa OUTROS campos (APELIDO/DESC_PRODUTO_EST/PESO_LIQUIDO/STATUS_ITEM), com semântica diferente — não serve para
-- repontar fn_com_venda_item sem mudar os números.
--
-- Correção ADITIVA e sem mudar números: uma view materializada DEDICADA (bi_comercial_venda_item_mv) que espelha
-- EXATAMENTE o SELECT de fn_com_venda_item (mesmos campos, mesmos filtros STATUS<>'C' e COD_PRODUTO<>'10'), indexada
-- por (company_id, dia). fn_com_venda_item passa a ler dela: 1.270 ms → ~8 ms por chamada (index only scan).
--
-- Prova de equivalência (RD-38, Frioeste 975365cc, ano 2026, antes de trocar a função):
--   itens 6393=6393 · valor 14.638.548,71=14.638.548,71 · kg 772.010,862=772.010,862
--   valor_tabela 14.861.469,78=14.861.469,78 · abaixo_tabela 3712=3712 · cargas 185=185 · carne 6326=6326
-- Chave única da MV: coluna REAL ind_atak_fato.chave_fato (6393 linhas, 0 nula, 6393 pares distintos) — NÃO o
-- raw->>'CHAVE_FATO' (número da NOTA, que se repete entre itens). Necessária para REFRESH CONCURRENTLY.
--
-- Atualização: a mesma rotina de 30 min (cron bi_comercial_item_refresh → fn_bi_comercial_item_refresh) passa a
-- refrescar também esta MV, mantendo as duas em sincronia. Próximo ERP (ex.: TOTVS) alimenta a MV com UNION ALL.

-- 1) View materializada dedicada, espelho fiel de fn_com_venda_item.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.bi_comercial_venda_item_mv AS
  SELECT
    f.company_id,
    f.chave_fato                                                           AS fato_id,  -- chave única por item (índice)
    'atak'::text                                                           AS origem,
    left(f.raw->>'DATA_MOVTO', 10)::date                                   AS dia,
    f.raw->>'CHAVE_FATO'                                                   AS nota,      -- número da NOTA (repete por item)
    coalesce(nullif(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v')             AS vendedor,
    trim(f.raw->>'COD_CLI_FOR')                                            AS cliente_cod,
    left(trim(f.raw->>'NOME_CADASTRO'), 40)                                AS cliente,
    initcap(trim(f.raw->>'CIDADE')) || '/' || trim(f.raw->>'UF')           AS cidade,
    trim(f.raw->>'COD_PRODUTO')                                            AS produto_cod,
    left(trim(f.raw->>'DESC_PRODUTO_NF'), 40)                              AS produto,
    split_part(f.raw->>'DESC_DIVISAO', ' - ', 1)                           AS linha,
    (left(f.raw->>'DESC_DIVISAO', 5) = 'CARNE'
     OR left(f.raw->>'DESC_DIVISAO', 6) = 'MIUDOS')                        AS carne,
    CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG'
         THEN (f.raw->>'QTDE_PRI')::numeric ELSE 0 END                     AS kg,
    (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric                                AS valor,
    CASE WHEN (f.raw->>'VALOR_UNITARIO_LISTA')::numeric > 0
         THEN (f.raw->>'VALOR_UNITARIO_LISTA')::numeric * (f.raw->>'QTDE_UND')::numeric
         ELSE (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric END                  AS valor_tabela,
    (f.raw->>'VALOR_UNITARIO')::numeric
      < (f.raw->>'VALOR_UNITARIO_LISTA')::numeric                          AS abaixo_tabela,
    nullif(trim(f.raw->>'NUM_CARGA'), '')                                  AS carga,
    coalesce(nullif(trim(f.raw->>'NOME_TRANSPORTADOR'), ''), 'Sem transportador') AS transportador
  FROM public.ind_atak_fato f
  WHERE f.dominio = 'comercial_venda_item'
    AND trim(f.raw->>'STATUS') <> 'C'
    AND trim(f.raw->>'COD_PRODUTO') <> '10'
WITH DATA;

-- Índice único (obrigatório para REFRESH CONCURRENTLY) + índice de leitura por período.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bi_comercial_venda_item_mv
  ON public.bi_comercial_venda_item_mv (company_id, fato_id);
CREATE INDEX IF NOT EXISTS ix_bi_comercial_venda_item_mv_dia
  ON public.bi_comercial_venda_item_mv (company_id, dia);

-- Sem acesso direto do cliente: a guarda de escopo vive em fn_bi_comercial_scope/painel (fail-closed).
REVOKE ALL ON public.bi_comercial_venda_item_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bi_comercial_venda_item_mv TO service_role;

-- 2) fn_com_venda_item passa a LER da MV (saída byte-a-byte idêntica, só muito mais rápida).
--    Mesma assinatura/colunas/tipos de antes; o filtro de data agora usa o índice (company_id, dia).
CREATE OR REPLACE FUNCTION public.fn_com_venda_item(p_company_id uuid, p_de date, p_ate date)
 RETURNS TABLE(origem text, dia date, nota text, vendedor text, cliente_cod text, cliente text, cidade text, produto_cod text, produto text, linha text, carne boolean, kg numeric, valor numeric, valor_tabela numeric, abaixo_tabela boolean, carga text, transportador text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT origem, dia, nota, vendedor, cliente_cod, cliente, cidade, produto_cod, produto, linha,
         carne, kg, valor, valor_tabela, abaixo_tabela, carga, transportador
    FROM public.bi_comercial_venda_item_mv
   WHERE company_id = p_company_id
     AND dia BETWEEN p_de AND p_ate
  -- Próximo ERP (ex.: TOTVS): alimenta a MV com UNION ALL; a função não muda.
$function$;

-- 3) A rotina de 30 min refresca também a MV nova (mesma transação lógica das duas).
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_item_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.bi_comercial_item_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.bi_comercial_venda_item_mv;
  INSERT INTO public.bi_comercial_item_status (company_id, atualizado_em)
  SELECT DISTINCT company_id, now() FROM public.bi_comercial_item_mv
  ON CONFLICT (company_id) DO UPDATE SET atualizado_em = EXCLUDED.atualizado_em;
  RETURN jsonb_build_object('ok', true, 'em', now());
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_item_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_item_refresh() TO service_role;

-- CI (check-fn-guards): função SECURITY DEFINER não pode ficar aberta a anon. Execução só pelo app logado e pelo serviço.
REVOKE ALL ON FUNCTION public.fn_com_venda_item(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_venda_item(uuid, date, date) TO authenticated, service_role;
