-- Fórmula final do faturamento na RAIZ fn_com_venda_item (CEO 13/11, contexto 61723f79) — URGENTE.
--
-- A #4938 aplicou a fórmula (categoria 'venda_faturamento' = T520,520) só em fn_bi_comercial_kpis (card do topo,
-- já devolve R$ 109,6 mi). MAS a tela /dashboard/comercial/meu-painel carrega de fn_bi_comercial_base, que lê o
-- ESPINHO de itens de public.fn_com_venda_item (a RAIZ). Essa raiz contava TODOS os tipos → a tela mostrava
-- R$ 115,8 mi. Corrigindo a raiz, fn_bi_comercial_base herda (já lê fn_com_venda_item) e o painel inteiro
-- (faturamento, volume, vendedores, produtos, concentração) passa a bater com a #4938.
--
-- REGRA (igual à #4938, por empresa — RD-102; semeada só p/ Frioeste em 20261115130030):
--   · FATURAMENTO (valor) = só os tipos 'venda_faturamento' (Frioeste: T520, 520).
--   · VOLUME (kg)        = os tipos 'entra_volume' (T520, 520, T830, T820) — despojo/couro entram no peso.
--   · Linhas de despojo (entra_volume mas NÃO venda_faturamento) entram com kg e valor = 0 (não inflam o
--     faturamento); balcão (5200/5201) e perda (5235) ficam FORA (nem no valor nem no volume).
--   · Empresa SEM config de tipos → comportamento ATUAL (sem filtro): nenhum outro cliente muda.
--
-- Prova no dado (SQL Editor, Frioeste 975365cc, 2026-01-01..2026-11-13): soma de fn_com_venda_item.valor ≈
-- R$ 109.677.622 e soma de .kg ≈ 5.762.183 kg — batendo com fn_bi_comercial_kpis.
--
-- O tipo de movimento vem de um join leve na ind_atak_fato pela chave única do item (f.chave_fato = m.fato_id),
-- mesmo padrão do fn_bi_comercial_pareto. Assinatura/colunas/tipos INALTERADOS; só a leitura muda. SECURITY
-- DEFINER + search_path fixo + REVOKE anon mantidos. Aditiva: só CREATE OR REPLACE de função, sem tocar dado.

CREATE OR REPLACE FUNCTION public.fn_com_venda_item(p_company_id uuid, p_de date, p_ate date)
 RETURNS TABLE(origem text, dia date, nota text, vendedor text, cliente_cod text, cliente text, cidade text, produto_cod text, produto text, linha text, carne boolean, kg numeric, valor numeric, valor_tabela numeric, abaixo_tabela boolean, carga text, transportador text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tf AS (SELECT array_agg(cod_tipo_mv) AS a FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento')),
       tv AS (SELECT array_agg(cod_tipo_mv) AS a FROM public.fn_comercial_tipos_efetivos(p_company_id, 'entra_volume'))
  SELECT m.origem, m.dia, m.nota, m.vendedor, m.cliente_cod, m.cliente, m.cidade, m.produto_cod, m.produto, m.linha,
         m.carne,
         m.kg,
         -- valor só dos tipos de faturamento; despojo (entra_volume não-faturamento) entra com valor 0
         CASE WHEN tf.a IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (tf.a) THEN m.valor ELSE 0 END          AS valor,
         CASE WHEN tf.a IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (tf.a) THEN m.valor_tabela ELSE 0 END  AS valor_tabela,
         m.abaixo_tabela, m.carga, m.transportador
    FROM public.bi_comercial_venda_item_mv m
    CROSS JOIN tf
    CROSS JOIN tv
    LEFT JOIN public.ind_atak_fato f
           ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_de AND p_ate
     -- só os tipos que entram no volume (ou tudo, se a empresa não configurou); exclui balcão (5200/5201) e perda (5235)
     AND (tv.a IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (tv.a))
  -- Próximo ERP: alimenta a MV com UNION ALL; a função não muda.
$function$;

REVOKE ALL ON FUNCTION public.fn_com_venda_item(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_venda_item(uuid, date, date) TO authenticated, service_role;
