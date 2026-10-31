-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/projetos/engenharia. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/projetos/engenharia/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_obra_planta','erp_obra_planta_ambiente','erp_orcamentos','erp_orcamentos_itens','v_projetos_bom_completo','v_projetos_servicos_catalogo']::text[],
    rpcs_chamadas = ARRAY['fn_takeoff_ambiente_atualizar','fn_takeoff_ambiente_criar_manual','fn_takeoff_gerar_orcamento','fn_takeoff_planta_salvar','fn_takeoff_sugerir_servicos']::text[]
WHERE rota = '/dashboard/projetos/engenharia';
