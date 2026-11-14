-- BI Comercial · SLICE 2 (item 2): painel "Produtos no cálculo" na tela /dashboard/inteligencia/comercial.
-- RD-95: o painel/ação tem o "?" (AjudaCampo) com chave existente no banco. Aditivo e idempotente
-- (WHERE NOT EXISTS, não depende de constraint). Catálogo de ajuda global, sem dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  (
    'comercial.bi.produtos_no_calculo',
    '/dashboard/inteligencia/comercial',
    'Produtos no cálculo',
    'Produtos no cálculo',
    'Para cada produto, escolha se ele ENTRA no cálculo limpo, fica FORA, ou segue "a classificar". Produto novo nasce "a classificar" (destacado) até você decidir. A escolha é salva por empresa.',
    'Define o que compõe o "faturamento com seleção", o preço médio e o R$/kg: cortes de carne marque "entra"; despojos (couro, sangue, descartados, resíduos, não comestíveis) marque "fora", para não baixar o R$/kg.',
    'Marcar "COURO" e "SANGUE" como "fora" e os cortes nobres como "entra": o R$/kg passa a refletir só a carne; o faturamento total continua somando tudo.',
    'Deixar despojo como "entra" (ou esquecer item "a classificar"): o preço médio e a margem saem distorcidos para baixo.',
    'comercial',
    30,
    'publicado'
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave
);
