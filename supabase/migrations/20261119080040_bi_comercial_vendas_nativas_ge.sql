-- PDCA GE · /dashboard/comercial/meu-painel · Princípio 1 (núcleo universal)
-- Problema (RD-38): fn_com_venda_item lê 100% de UMA vertical (importação ATAK, via
--   bi_comercial_venda_item_mv). Empresas que vendem pelo fluxo NATIVO (pedido->faturado)
--   veem "Meu Painel" vazio. Provado na DEMO Comércio GE (b07..004): 8 pedidos FATURADOS
--   (R$ 6.572,80) e 0 linha no painel.
-- Correção ADITIVA: a função ganha um caminho GENÉRICO que lê as vendas nativas faturadas
--   (erp_pedidos + erp_pedidos_itens) mapeadas para o MESMO shape. O caminho ATAK fica
--   INTACTO (Princípio 5 anti-regressão). KG/carne/linha/carga são de frigorífico: ficam
--   opcionais (0/false/null) no caminho nativo.
-- Guarda anti-dupla-contagem: o caminho nativo só entra quando a empresa NÃO tem fatos ATAK
--   comerciais (fonte disponível por empresa); empresa ATAK não é tocada.
-- Idempotente: CREATE OR REPLACE. Sem alteração de dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_com_venda_item(p_company_id uuid, p_de date, p_ate date)
 RETURNS TABLE(origem text, dia date, nota text, vendedor text, cliente_cod text, cliente text, cidade text, produto_cod text, produto text, linha text, carne boolean, kg numeric, valor numeric, valor_tabela numeric, abaixo_tabela boolean, carga text, transportador text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tf AS (SELECT array_agg(cod_tipo_mv) AS a FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento')),
       tv AS (SELECT array_agg(cod_tipo_mv) AS a FROM public.fn_comercial_tipos_efetivos(p_company_id, 'entra_volume'))
  -- (1) Caminho ATAK (importação) — INALTERADO
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

  UNION ALL

  -- (2) Caminho NATIVO (genérico) — vendas faturadas do fluxo pedido->faturado.
  -- Só para empresas SEM fato ATAK comercial (fonte disponível por empresa; sem dupla contagem).
  SELECT 'nativo'::text,
         COALESCE(p.data_faturamento, p.data_pedido)                                   AS dia,
         COALESCE(NULLIF(btrim(p.nf_numero), ''), p.numero)                            AS nota,
         COALESCE(NULLIF(btrim(p.vendedor_nome), ''), 's/v')                           AS vendedor,
         COALESCE(p.cliente_id::text, NULLIF(btrim(p.cliente_cnpj), ''))               AS cliente_cod,
         left(COALESCE(btrim(p.cliente_nome), ''), 40)                                 AS cliente,
         CASE WHEN NULLIF(btrim(p.obra_cidade), '') IS NOT NULL
              THEN initcap(btrim(p.obra_cidade)) || COALESCE('/' || NULLIF(btrim(p.obra_uf), ''), '')
              ELSE NULL END                                                            AS cidade,
         NULLIF(COALESCE(btrim(pi.produto_codigo), btrim(pi.servico_codigo)), '')      AS produto_cod,
         left(COALESCE(NULLIF(btrim(pi.produto_nome), ''), NULLIF(btrim(pi.produto_descricao), ''), NULLIF(btrim(pi.servico_descricao), ''), ''), 40) AS produto,
         NULL::text                                                                    AS linha,   -- "linha/divisão" é conceito de frigorífico: opcional
         false                                                                         AS carne,   -- idem
         CASE WHEN upper(btrim(COALESCE(pi.unidade, ''))) = 'KG' THEN COALESCE(pi.quantidade, 0) ELSE 0 END AS kg, -- peso opcional
         COALESCE(pi.subtotal, 0)                                                      AS valor,
         COALESCE(NULLIF(COALESCE(pi.quantidade, 0) * COALESCE(pi.preco_unitario, 0), 0), pi.subtotal, 0) AS valor_tabela,
         (COALESCE(pi.desconto_valor, 0) > 0
          OR COALESCE(pi.subtotal, 0) < COALESCE(pi.quantidade, 0) * COALESCE(pi.preco_unitario, 0))      AS abaixo_tabela,
         NULL::text                                                                    AS carga,   -- carga é de frigorífico: opcional
         COALESCE(NULLIF(btrim(p.transportadora), ''), 'Sem transportador')            AS transportador
    FROM public.erp_pedidos p
    JOIN public.erp_pedidos_itens pi ON pi.pedido_id = p.id
   WHERE p.company_id = p_company_id
     AND p.status = 'faturado'
     AND COALESCE(p.data_faturamento, p.data_pedido) BETWEEN p_de AND p_ate
     AND NOT EXISTS (
       SELECT 1 FROM public.ind_atak_fato af
        WHERE af.company_id = p_company_id AND af.dominio = 'comercial_venda_item'
     )
$function$;

-- ACL explícita (gate check_fn_guards · revoke_anon): reproduz a ACL viva {authenticated, service_role}
REVOKE ALL ON FUNCTION public.fn_com_venda_item(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_venda_item(uuid, date, date) TO authenticated, service_role;
