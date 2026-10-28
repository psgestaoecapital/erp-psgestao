-- Hub · RD-98 pilar 3 (origem do dado) · cockpit, obras, resultado por obra e propostas (dev7claudeps)
-- Delta do auditor 27/10 15:29: views_consumidas/rpcs_chamadas estavam 0/0 nas 4 rotas.
-- Preenchido com o que cada page.tsx lê de fato (RD-38, conferido no código).
-- Migration ADITIVA de metadado (só system_screens). Sem alteração de função/tela/dado de cliente.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado_alocado','projetos_obras']::text[],
       rpcs_chamadas = ARRAY[]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/cockpit';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado','projetos_obras']::text[],
       rpcs_chamadas = ARRAY['fn_obras_kpis','fn_obras_listar','fn_obras_receita','fn_obra_mudar_status','fn_obra_escopo','fn_obra_item_adicionar','fn_obra_item_excluir','fn_obra_fiscal_obter','fn_obra_salvar_fiscal']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado','v_obra_resultado_alocado']::text[],
       rpcs_chamadas = ARRAY['fn_obras_receita']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/resultado';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_orcamentos','erp_orcamentos_itens','erp_crm_oportunidade','erp_obra_planta','erp_crm_visita','projetos_modulo_config','projetos_obras']::text[],
       rpcs_chamadas = ARRAY[]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/propostas';
