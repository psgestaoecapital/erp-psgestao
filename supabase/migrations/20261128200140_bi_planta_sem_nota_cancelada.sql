-- BI da Planta: a compra de gado deixa de contar NOTA CANCELADA (SPEC único CEO 27/11, PARTE C).
-- Code: code-desenvolvedor-3
--
-- Problema (RD-38, FRIOESTE, domínio compra_gado): o tradutor fn_ind_compra_gado — que alimenta o bloco "compra"
-- (cabeças, kg, R$/@, custo por cabeça, meses, categorias, cidades, produtores) da fn_bi_planta_abate — não
-- filtrava a nota cancelada. No raw ATAK a nota cancelada vem com STATUS = 'C' (STATUS_NFE 'X' cancelada ou
-- 'I' inutilizada); a nota válida vem com STATUS = 'F'. É o mesmo critério que o BI de Compra de Animais
-- já usa (fn_ind_compra_gado_item: coalesce(STATUS,'') <> 'C'; fn_ind_compra_gado_cancelada: STATUS = 'C').
--
-- Mudança: só a linha do filtro + a guarda de empresa (padrão molde: SECURITY DEFINER ignora RLS). Mesma
-- assinatura, mesmas colunas, mesmo grão; nada na coleta (atak_conexao_config, erp_credencial, erp_sync_log,
-- ETL) é tocado. Tradutor segue fora do alcance da tela (REVOKE reafirmado).

CREATE OR REPLACE FUNCTION public.fn_ind_compra_gado(p_company_id uuid, p_de date, p_ate date)
 RETURNS TABLE(origem text, dia date, produtor_cod text, produtor text, cidade text, categoria text, sexo text, nota10 boolean, cabecas numeric, kg numeric, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Ramo ATAK (importação ind_atak_fato, domínio compra_gado). Outro ERP: novo SELECT com as mesmas colunas, UNION ALL.
  SELECT 'atak'::text,
    left(f.raw->>'DATA_MOVTO', 10)::date,
    trim(f.raw->>'COD_CLI_FOR'),
    left(initcap(trim(coalesce(nullif(f.raw->>'APELIDO', ''), f.raw->>'NOME_CADASTRO'))), 40),
    coalesce(nullif(trim(f.raw->>'CIDADE'), ''), 'Sem cidade'),
    trim(f.raw->>'DESC_PRODUTO_EST'),
    CASE WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE 'FEMEA%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE 'VACA%' THEN 'F'
         WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE 'MACHO%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE 'BOI%' THEN 'M' END,
    f.raw->>'DESC_PRODUTO_EST' ILIKE '%NOTA 10%',
    coalesce((f.raw->>'QTDE_AUX')::numeric, 0),
    coalesce((f.raw->>'QTDE_PRI')::numeric, 0),
    coalesce((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric, 0)
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'compra_gado'
    -- guarda de empresa (multi-tenant): SECURITY DEFINER ignora RLS e o UUID da empresa não é segredo.
    AND (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
    AND f.raw->>'COD_TIPO_MV' IN ('T231', 'T234')
    AND f.raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%'
    -- nota cancelada fora da conta (STATUS 'C' no ATAK) — distorcia cabeças, kg e a arroba.
    AND coalesce(f.raw->>'STATUS', '') <> 'C'
    AND f.raw->>'DATA_MOVTO' >= p_de::text AND f.raw->>'DATA_MOVTO' < (p_ate + 1)::text
$function$;

REVOKE ALL ON FUNCTION public.fn_ind_compra_gado(uuid, date, date) FROM PUBLIC, anon, authenticated;
