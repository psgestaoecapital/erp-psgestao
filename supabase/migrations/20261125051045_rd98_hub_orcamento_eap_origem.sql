-- PDCA Hub · RD-98 p3 (origem do dado) · completa a origem do dado das telas 315/334 (orçamento por EAP)
-- Code: desenvolvedor_4_g
--
-- Problema (auditor PDCA · RD-98 p3): as duas telas do orçamento por EAP já têm linha em system_screens,
-- mas a ORIGEM DO DADO está incompleta/vazia — o aud8 não confere de onde cada tela lê/grava:
--   /dashboard/projetos/obras/[id]/orcamento            → rpcs_chamadas só com 1 de 5; views_consumidas NULL
--   /dashboard/projetos/obras/[id]/orcamento/importar   → views_consumidas NULL
-- São exatamente as telas que a FC Pisos (prestadora · pisos) usa na terça (Onda C-2). Sem a origem completa,
-- a RD-98 p3 fica parcial e a tela não fecha o termômetro.
--
-- Fontes CONFERIDAS no código vivo (main), não supostas (RD-38):
--   src/app/dashboard/projetos/obras/[id]/orcamento/page.tsx
--     rpcs_chamadas:    fn_projetos_orcamento_eap_arvore (l.93), fn_projetos_orcamento_item_eap_listar (l.98),
--                       fn_projetos_orcamento_item_eap_excluir (l.157), fn_projetos_orcamento_garantir (l.169),
--                       fn_projetos_orcamento_item_eap_salvar (l.195)
--     views_consumidas: projetos_obras (l.88), erp_orcamentos (l.101), erp_orcamentos_itens (l.104),
--                       projetos_servicos (l.111)
--   src/app/dashboard/projetos/obras/[id]/orcamento/importar/page.tsx
--     rpcs_chamadas:    fn_projetos_orcamento_eap_importar_validar (l.297), fn_projetos_orcamento_eap_importar (l.310)
--     views_consumidas: projetos_obras (l.188)
-- Os 7 RPCs (public) e as 4 tabelas existem no banco (conferido em pg_proc/pg_class).
--
-- Aditivo e idempotente: só UPDATE em system_screens (catálogo de telas, metadado interno de auditoria);
-- não toca núcleo, RLS, menu, função nem dado de cliente. Re-run grava os MESMOS valores.
--
-- RD-38 (produção):
--   ANTES: /orcamento rpcs={fn_projetos_orcamento_eap_arvore}, views=NULL ;
--          /orcamento/importar views=NULL
--   DEPOIS: /orcamento rpcs = 5 funções, views = 4 tabelas ;
--           /orcamento/importar views = {projetos_obras} (rpcs intactos)

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_projetos_orcamento_eap_arvore',
      'fn_projetos_orcamento_item_eap_listar',
      'fn_projetos_orcamento_item_eap_excluir',
      'fn_projetos_orcamento_garantir',
      'fn_projetos_orcamento_item_eap_salvar'
    ]::text[],
    views_consumidas = ARRAY[
      'projetos_obras',
      'erp_orcamentos',
      'erp_orcamentos_itens',
      'projetos_servicos'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/projetos/obras/[id]/orcamento';

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_projetos_orcamento_eap_importar_validar',
      'fn_projetos_orcamento_eap_importar'
    ]::text[],
    views_consumidas = ARRAY[
      'projetos_obras'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/projetos/obras/[id]/orcamento/importar';
