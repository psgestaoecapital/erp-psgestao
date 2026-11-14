-- BI Comercial · SLICE 2 (item 3): dois totais no topo da tela /dashboard/inteligencia/comercial.
-- RD-95: todo indicador tem o "?" (AjudaCampo), com a chave existente no banco. Aqui cadastro os textos
-- de ajuda dos DOIS totais ("com seleção" × "faturamento total"). Aditivo e idempotente (WHERE NOT EXISTS,
-- não depende de constraint). Catálogo de ajuda global, sem dado de cliente. Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  (
    'comercial.bi.total_faturamento',
    '/dashboard/inteligencia/comercial',
    'Totais do topo',
    'Faturamento total',
    'Mostra o faturamento de TUDO que foi vendido no período, inclusive despojos (couro, sangue, descartados e demais itens não comestíveis). Nada sai desse número.',
    'É a régua do caixa: o quanto entrou de verdade. Serve para bater com o financeiro e para ver o peso dos despojos (total menos "com seleção").',
    'Se no período houve R$ 13,5 mi em tudo e R$ 12,0 mi nos cortes marcados "entra", os despojos responderam por R$ 1,5 mi.',
    'Confundir com o "com seleção": o total nunca tira despojo nem produto a classificar — ele soma tudo.',
    'comercial',
    10,
    'publicado'
  ),
  (
    'comercial.bi.total_com_selecao',
    '/dashboard/inteligencia/comercial',
    'Totais do topo',
    'Faturamento com seleção',
    'Mostra o faturamento só dos produtos marcados como "entra" no painel "Produtos no cálculo". Despojos e itens "a classificar" ficam de fora, para o preço e a margem saírem limpos.',
    'É a base para preço médio, R$/kg e margem por corte — sem a distorção dos despojos. Use para comparar vendedores e clientes com a mesma régua.',
    'Com os cortes nobres marcados "entra", o "com seleção" exclui couro e sangue e o R$/kg passa a refletir só a carne vendida.',
    'Marcar um despojo como "entra" (ou esquecer um corte como "a classificar") distorce o R$/kg — confira o painel "Produtos no cálculo".',
    'comercial',
    20,
    'publicado'
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave
);
