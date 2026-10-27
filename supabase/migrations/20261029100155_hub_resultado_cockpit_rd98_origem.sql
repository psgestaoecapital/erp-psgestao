-- Hub · Resultado por obra e Cockpit — RD-98 pilar 3 (origem do dado): declara as views e RPCs que cada tela lê.
-- ADITIVA: só preenche metadados de system_screens (nenhum dado de cliente, nenhuma função alterada).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado_alocado', 'v_obra_resultado', 'projetos_obras', 'erp_nfse_obra_medicao', 'erp_pedidos', 'erp_nfse_emitidas'],
       rpcs_chamadas = ARRAY['fn_obras_receita']
 WHERE rota = '/dashboard/projetos/obras/resultado';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado_alocado', 'v_obra_resultado', 'projetos_obras', 'projetos_obra_item'],
       rpcs_chamadas = ARRAY[]::text[]
 WHERE rota = '/dashboard/projetos/cockpit';
