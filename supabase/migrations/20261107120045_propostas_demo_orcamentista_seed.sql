-- Gap 1(b) · PDCA Hub /dashboard/projetos/propostas (#3270/#3271): seed DEMO de orçamentista.
-- RD-38 (antes): as 6 propostas da Construtora DEMO (b07..006) estavam 100% com orcamentista_id NULL,
-- então a coluna "Orçamentista" e o filtro "Meus orçamentos" nasciam mortos no DEMO (nada para ver/filtrar).
-- Agora PARTE das propostas recebe orcamentista_id/_nome de usuários REAIS da própria empresa DEMO,
-- deixando testáveis ao mesmo tempo: a coluna preenchida, o filtro "Meus" (Auditor PDCA = quem audita o DEMO)
-- e o estado "sem orçamentista" (004/005/FC1 ficam vazias de propósito).
-- Aditiva e idempotente: só grava onde orcamentista_id ainda é NULL; re-rodar é no-op.
-- NÃO é dado de cliente real — é a empresa DEMO de demonstração/auditoria (RD-69).

UPDATE public.erp_orcamentos
   SET orcamentista_id = 'a621c50f-45e4-4944-9a67-5a8c6c4e29ef',
       orcamentista_nome = 'Auditor PDCA (robô de auditoria, só DEMO)'
 WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
   AND numero = 'DEMO-ORC-001' AND deleted_at IS NULL AND orcamentista_id IS NULL;

UPDATE public.erp_orcamentos
   SET orcamentista_id = 'f3867e65-94d6-43c0-aeb9-8da82fcfe433',
       orcamentista_nome = 'André Luiz Salvi'
 WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
   AND numero = 'DEMO-ORC-002' AND deleted_at IS NULL AND orcamentista_id IS NULL;

UPDATE public.erp_orcamentos
   SET orcamentista_id = '43ef8386-3262-4e56-b31a-6f0e41d1e21c',
       orcamentista_nome = 'Jordana Carolina Richter'
 WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
   AND numero = 'DEMO-ORC-003' AND deleted_at IS NULL AND orcamentista_id IS NULL;
