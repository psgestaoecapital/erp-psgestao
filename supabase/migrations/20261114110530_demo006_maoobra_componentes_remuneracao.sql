-- Chamado #3365 (Hub · Mão de Obra) — DEMO Construtora (006) com componentes de remuneração
-- ============================================================================
-- GAP (auditor PDCA, /dashboard/projetos/mao-obra): a DEMO Construtora Modelo
-- (companies b0700000-0000-4000-a000-000000000006, ambiente_tenant='auditoria') já tem
-- as funções e as 14 fichas ativas com os 5 vínculos (CLT, CLT intermitente, RPA, MEI/PJ,
-- diarista), MAS 8 fichas ainda NÃO têm componentes de remuneração explícitos — calculam o
-- custo só pelo FALLBACK de ficha antiga (salário/valor_unidade). O auditor pede os
-- componentes presentes (fixo, produção m², etc.) para a jornada ficar completa.
--
-- CORREÇÃO (provisionamento de DEMO, aditiva): cria o componente que faltava em cada uma
-- dessas 8 fichas, reproduzindo EXATAMENTE o que o fallback já calculava:
--   · CLT / CLT intermitente (mensal): componente 'fixo/mensal' = salário, com as chaves
--     padrão do vínculo (integra remuneração, 13º/férias e encargos; sem DSR) — mesmo custo.
--   · PJ por m² (produção): componente 'producao' (unidade m²) = valor_unidade × volume
--     mensal planejado da função, dando um custo/m² honesto (o fallback deixava o custo nulo
--     por não ter volume). Volume por função (medição mensal típica de obra).
--
-- SEGURANÇA / COMPATIBILIDADE:
--  - ADITIVA e IDEMPOTENTE: só INSERE componente em ficha que ainda NÃO tem nenhum
--    (NOT EXISTS). Re-rodar não duplica. Não altera, não apaga nada.
--  - Guarda DUPLA: só a empresa DEMO de auditoria (id fixo …006 E ambiente_tenant='auditoria').
--    NUNCA toca dado de cliente real.
--  - Sem DDL, sem RLS, sem função, sem grant. Só dado de empresa DEMO.
--  - RD-38 (provado em produção, SÓ leitura, fn_mao_obra_custo_calcular com os componentes
--    propostos vs. o atual, sem gravar):
--      CLT (custo_mensal inalterado): Carpinteiro 5881,82=5881,82 · Eletricista 6216,61=6216,61 ·
--        Mestre de obras 9564,48=9564,48 · Pedreiro 5547,03=5547,03 · Servente 4040,48=4040,48.
--      PJ m² (custo_mensal nulo -> populado): Aplicador 22×420=9240,00 · Gesseiro 18×350=6300,00 ·
--        Pintor 14×600=8400,00.
-- ============================================================================

-- (A) CLT e CLT intermitente mensais sem componente: 'fixo/mensal' = salário (reproduz o fallback)
INSERT INTO public.erp_mao_obra_componente
  (ficha_id, company_id, ordem, tipo, subtipo, descricao, valor, quantidade, unidade,
   estimado, gera_dsr, integra_13_ferias, incide_encargos, integra_remuneracao)
SELECT k.id, k.company_id, 1, 'fixo', 'mensal', 'Salário base mensal', k.salario, 0, NULL,
       false, false, true, true, true
  FROM public.erp_mao_obra_custo k
  JOIN public.companies c ON c.id = k.company_id
 WHERE c.id = 'b0700000-0000-4000-a000-000000000006'
   AND c.ambiente_tenant = 'auditoria'
   AND k.vigencia_fim IS NULL
   AND k.vinculo IN ('clt', 'clt_intermitente')
   AND k.forma_pagamento = 'mensal'
   AND COALESCE(k.salario, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_componente x WHERE x.ficha_id = k.id);

-- (B) PJ por m² (produção) sem componente: 'producao' (m²) = valor_unidade × volume mensal da função
INSERT INTO public.erp_mao_obra_componente
  (ficha_id, company_id, ordem, tipo, subtipo, descricao, valor, quantidade, unidade,
   estimado, gera_dsr, integra_13_ferias, incide_encargos, integra_remuneracao)
SELECT k.id, k.company_id, 1, 'producao', NULL,
       'Produção mensal medida (m²)', k.valor_unidade,
       CASE fn.nome
         WHEN 'Aplicador de piso vinílico' THEN 420
         WHEN 'Gesseiro' THEN 350
         WHEN 'Pintor' THEN 600
         ELSE 400
       END,
       'm2', false, false, false, false, false
  FROM public.erp_mao_obra_custo k
  JOIN public.erp_funcao_mao_obra fn ON fn.id = k.funcao_id
  JOIN public.companies c ON c.id = k.company_id
 WHERE c.id = 'b0700000-0000-4000-a000-000000000006'
   AND c.ambiente_tenant = 'auditoria'
   AND k.vigencia_fim IS NULL
   AND k.vinculo = 'pj'
   AND k.forma_pagamento IN ('m2', 'producao')
   AND COALESCE(k.valor_unidade, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_componente x WHERE x.ficha_id = k.id);
