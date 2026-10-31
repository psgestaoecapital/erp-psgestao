-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela /dashboard/pm/equipe.
-- Inclui o componente CargaEquipe (Carga × capacidade) que a tela renderiza. Aditivo: só metadado, idempotente.
-- Listas do grep .from()/.rpc() de page.tsx + src/components/pm/CargaEquipe.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'agency_equipe','rbac_papel','agency_jobs','agency_tarefas',
      'agency_propostas','agency_proposta_itens','agency_contratos'
    ]::text[],
    rpcs_chamadas = ARRAY[
      'fn_pm_papel_agencia_previa','fn_pm_papel_agencia_aplicar','fn_usuarios_da_empresa'
    ]::text[]
WHERE rota = '/dashboard/pm/equipe';
