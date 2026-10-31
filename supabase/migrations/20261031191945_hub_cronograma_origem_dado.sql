-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens da tela /dashboard/projetos/obras/[id]/cronograma.
-- Rota de detalhe (menu N/A). Listas do grep .from()/.rpc() de page.tsx. Aditivo, idempotente, só metadado.
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'projetos_obra_tarefa','projetos_obra_tarefa_item','projetos_obra_tarefa_dependencia',
      'projetos_obra_tarefa_avanco','projetos_obra_item','projetos_obra_os',
      'projetos_obra_rdo','projetos_obra_mao_obra_apontamento'
    ]::text[],
    rpcs_chamadas = ARRAY[
      'fn_obra_tarefa_salvar','fn_obra_tarefa_excluir','fn_obra_tarefa_itens_salvar',
      'fn_obra_tarefa_dependencia_salvar','fn_obra_tarefa_custo_salvar',
      'fn_obra_cronograma_linha_base','fn_obra_necessidades_periodo'
    ]::text[]
WHERE rota = '/dashboard/projetos/obras/[id]/cronograma';
