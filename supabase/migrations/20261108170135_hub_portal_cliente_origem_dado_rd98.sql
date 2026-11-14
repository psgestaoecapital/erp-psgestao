-- PDCA Hub · /dashboard/projetos/obras/[id]/portal-cliente (auditor_pdca_1, 08/11).
-- GAP ÚNICO (RD-98 p3 · origem do dado incompleta): system_screens.rpcs_chamadas listava só as RPCs de
-- acesso (conceder/revogar/listar) + fn_ajuda_campo_listar, mas a seção "Prévia do que o cliente vê" chama
-- fn_obra_portal_avanco / _fotos / _medicoes (page.tsx l.94-96). Sem elas, o pilar 3 do RD-98 fica incompleto.
-- FIX aditivo/idempotente: ACRESCENTA as 3 RPCs (sem remover as existentes nem mexer nas views). Não toca dado de cliente.
UPDATE public.system_screens
   SET rpcs_chamadas = rpcs_chamadas
       || ARRAY(SELECT x FROM unnest(ARRAY['fn_obra_portal_avanco','fn_obra_portal_fotos','fn_obra_portal_medicoes']) x
                 WHERE x <> ALL(COALESCE(rpcs_chamadas, ARRAY[]::text[]))),
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/[id]/portal-cliente';
