-- Hub · Desempenho Comercial (/dashboard/projetos/desempenho) — RD-98 pilar 3: origem do dado.
-- ADITIVA: só preenche views_consumidas / rpcs_chamadas da rota em system_screens.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_crm_oportunidade', 'erp_orcamentos'],
       rpcs_chamadas = ARRAY['fn_crm_desempenho']
 WHERE rota = '/dashboard/projetos/desempenho';
