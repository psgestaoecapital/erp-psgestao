-- CONECTOR ATAK (Frioeste 975365cc-9e5a-4251-9022-68c6bfde10d8) — PRIORIDADE MÁXIMA (CEO 12/11).
-- Troca a fonte de DEVOLUÇÃO pela view completa de movimentos de entrada e cria a fonte de DESCARTE.
--
-- PORQUÊ (decisão CEO 12/11, chat eng_chefe): o faturamento LÍQUIDO da Frioeste (#4809, no ar) usa
-- hoje só a devolução da fonte antiga dbo.vwMovtoSaida_DevVendedor, que casa a devolução pela NOTA
-- ORIGINAL (não pela data de lançamento) e deixa buracos: abate ~R$ 342 mil de T582 em out/2026,
-- enquanto o ATAK desconta ~R$ 912 mil. A view nova dbo.vwMovtoEntrada_Novo traz TODOS os movimentos
-- de entrada (devolução completa + descarte), com a mesma chave de fato — fecha o líquido com o ATAK.
--
-- ESCOPO (config do conector — RD-102, NÃO é domínio de negócio): só mexe em atak_fonte_mapa (mapa de
-- fontes do coletor/ETL) e no catálogo global de tipos erp_comercial_tipo_movimento. Nenhuma função de
-- cálculo, view de negócio ou dado de cliente é alterado. Aditiva e idempotente.
--
-- ============================ PROVA RD-38 (leitura em produção) ============================
-- O coletor despeja CADA coluna da fonte, verbatim, em public.ind_atak_fato.raw (jsonb). As RPCs do
-- painel comercial (fn_bi_comercial_kpis / _base / _ranking_pontuacao) leem do raw por NOME de coluna:
--   VALOR_LIQUIDO_ITEM, STATUS, COD_UNIDADE_PRI, QTDE_PRI, DATA_MOVTO, COD_TIPO_MV, COD_VEND_COMP,
--   NOME_VENDEDOR, DESC_PRODUTO_NF, DESC_DIVISAO.
-- A fonte ANTIGA (vwMovtoSaida_DevVendedor) já é uma view de MOVIMENTO do ATAK e, provado no banco,
-- entrega exatamente esse vocabulário largo de colunas no raw de comercial_devolucao:
--   total=1160 · com VALOR_LIQUIDO_ITEM=1160 · com STATUS=1160 (status 'C'=0) · COD_UNIDADE_PRI='KG'=1159
--   · com COD_VEND_COMP=1160 · chaves do raw incluem CHAVE_FATO/NUM_ITEM/NUM_SUBITEM/VALOR_LIQUIDO_ITEM/
--     VALOR_TOTAL_ITEM/STATUS/COD_UNIDADE_PRI/DESC_PRODUTO_NF/DESC_DIVISAO/NOME_VENDEDOR/COD_VEND_COMP.
-- dbo.vwMovtoEntrada_Novo é da MESMA família de view de movimento (Jian confirmou COD_TIPO_MV, COD_PRODUTO,
-- QTDE_PRI, VALOR_TOTAL_ITEM, DATA_MOVTO, NOME_VENDEDOR, COD_VEND_COMP, COD_CLI_FOR, CHAVE_FATO/NUM_ITEM/
-- NUM_SUBITEM) — mesmo vocabulário. Por isso o repoint mantém os nomes que as RPCs leem e o líquido
-- continua calculando. VALIDAÇÃO DE ATIVAÇÃO (eng_chefe/Jian, antes da 1ª janela): contar por COD_TIPO_MV
-- na fonte nova e confirmar que o raw landado traz VALOR_LIQUIDO_ITEM/STATUS/COD_UNIDADE_PRI (se a view
-- nova expuser só VALOR_TOTAL_ITEM, aliasar no SELECT da fonte — ver observação ao fim).
--
-- Distribuição atual (staging comercial_devolucao, fonte antiga), prova RD-38:
--   T582: 996 linhas · R$ 3.893.664,56   |   T583: 164 linhas · R$ 144.768,13
-- Chave de fato idêntica (CONCAT(CHAVE_FATO,'|',NUM_ITEM,'|',NUM_SUBITEM)) => a transição é idempotente:
-- a janela nova UPSERTa sobre a mesma chave, sem duplicar o T582 (a fonte antiga é desativada aqui).
-- ==========================================================================================

-- 1) DESATIVAR a fonte antiga de devolução (não apagar — RD-30, histórico). Não entra mais no coletor.
UPDATE public.atak_fonte_mapa
   SET ativo = false
 WHERE dominio = 'comercial_devolucao'
   AND tabela_origem = 'dbo.vwMovtoSaida_DevVendedor'
   AND company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8';

-- 2) NOVA fonte de DEVOLUÇÃO completa (T582 + T583 + T585) sobre a view de entrada.
--    Filtro por COD_TIPO_MV na própria definição da fonte (mesmo padrão de comercial_venda_item).
INSERT INTO public.atak_fonte_mapa
  (company_id, dominio, tabela_origem, chave_fato_sql, coluna_watermark, colunas_parse, ativo, ordem, full_refresh)
SELECT '975365cc-9e5a-4251-9022-68c6bfde10d8', 'comercial_devolucao',
       '(SELECT * FROM dbo.vwMovtoEntrada_Novo WHERE COD_TIPO_MV IN (''T582'',''T583'',''T585'')) v',
       'CONCAT(CHAVE_FATO,''|'',NUM_ITEM,''|'',NUM_SUBITEM)', 'DATA_MOVTO', '{}'::jsonb, true, 190, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.atak_fonte_mapa m
   WHERE m.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
     AND m.dominio = 'comercial_devolucao'
     AND m.tabela_origem = '(SELECT * FROM dbo.vwMovtoEntrada_Novo WHERE COD_TIPO_MV IN (''T582'',''T583'',''T585'')) v');

-- 3) NOVA fonte de DESCARTE / PERDA (T131) sobre a mesma view de entrada.
INSERT INTO public.atak_fonte_mapa
  (company_id, dominio, tabela_origem, chave_fato_sql, coluna_watermark, colunas_parse, ativo, ordem, full_refresh)
SELECT '975365cc-9e5a-4251-9022-68c6bfde10d8', 'comercial_descarte',
       '(SELECT * FROM dbo.vwMovtoEntrada_Novo WHERE COD_TIPO_MV IN (''T131'')) v',
       'CONCAT(CHAVE_FATO,''|'',NUM_ITEM,''|'',NUM_SUBITEM)', 'DATA_MOVTO', '{}'::jsonb, true, 195, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.atak_fonte_mapa m
   WHERE m.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
     AND m.dominio = 'comercial_descarte'
     AND m.tabela_origem = '(SELECT * FROM dbo.vwMovtoEntrada_Novo WHERE COD_TIPO_MV IN (''T131'')) v');

-- 4) Catálogo global: acrescentar T585 como devolucao_abate (padrão PS, company_id NULL). Idempotente.
--    Mantém o índice único ux_comercial_tipo_mov_empresa (COALESCE(company_id,...),categoria,cod_tipo_mv).
INSERT INTO public.erp_comercial_tipo_movimento (company_id, categoria, cod_tipo_mv, descricao)
SELECT NULL::uuid, 'devolucao_abate', 'T585', 'Devolução de venda — complemento (entrada)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_comercial_tipo_movimento e
   WHERE e.company_id IS NULL AND e.categoria = 'devolucao_abate' AND e.cod_tipo_mv = 'T585');

-- ============================ OBSERVAÇÕES PARA ATIVAÇÃO ============================
-- (a) BACKFILL out/2026: a carga normal é por janela (watermark DATA_MOVTO). A view tem registros antigos
--     (2016); para pegar out/2026 completo de uma vez, rodar UMA janela maior com PS_JANELA grande,
--     coordenado com o CEO/Jian (não é automático nesta migration).
-- (b) SE a view nova expuser o valor só como VALOR_TOTAL_ITEM (e não VALOR_LIQUIDO_ITEM) ou o vendedor só
--     como NOME_VENDEDOR, basta aliasar no SELECT da fonte, p.ex.:
--       (SELECT *, VALOR_TOTAL_ITEM AS VALOR_LIQUIDO_ITEM FROM dbo.vwMovtoEntrada_Novo WHERE ...) v
--     — decisão travada na ativação, após contar as colunas reais do raw (prova RD-38).
