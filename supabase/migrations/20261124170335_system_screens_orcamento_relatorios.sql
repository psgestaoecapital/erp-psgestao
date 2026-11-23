-- PDCA Hub · RD-98 p3 (origem do dado) · registra a tela de Relatórios do orçamento por EAP em system_screens
-- Code: code-desenvolvedor-3
--
-- Problema (auditor_pdca_1, 22/11): a rota /dashboard/projetos/obras/[id]/orcamento/relatorios NÃO tinha
-- linha em system_screens (SELECT count=0 por rota). As irmãs /orcamento e /orcamento/importar já estão
-- catalogadas; esta ficou de fora. Sem a linha, o aud8 não gera nota e a tela nunca fecha o termômetro.
-- A jornada da tela está VERDE (reachability pelo Cockpit, "?" RD-95 presente, matemática §330 do PR #5852).
--
-- Mesma receita das PRs #5574/#5575. Catálogo (aditivo, idempotente por rota); não toca núcleo nem dado de cliente.
-- Fontes conferidas no código (src/app/dashboard/projetos/obras/[id]/orcamento/relatorios/page.tsx, main 1c35d2d):
--   rpcs_chamadas:    fn_projetos_orcamento_eap_arvore (l.52), fn_projetos_orcamento_item_eap_listar (l.55)
--   views_consumidas: projetos_obras (l.47), erp_orcamentos (l.58), erp_orcamentos_itens (l.60)
--
-- RD-38: ANTES count(rota)=0 ; DEPOIS count(rota)=1 (demais linhas intactas; re-run não duplica).

INSERT INTO system_screens (
  id, rota, area, modulo, titulo, descricao_funcional,
  rpcs_chamadas, views_consumidas,
  estado_real, prioridade_monitoramento, auditavel_robo, criado_em, atualizado_em
)
SELECT
  gen_random_uuid()::text,
  '/dashboard/projetos/obras/[id]/orcamento/relatorios',
  'hub_construcao',
  'projetos_obras',
  'Relatórios do orçamento por EAP',
  'Relatórios do orçamento da obra pela EAP: visão Sintética (árvore material × mão de obra × total e % por etapa) e Analítica (todos os itens com custos unitários e subtotal), com exportação CSV que separa Total estruturado pela EAP, Itens sem EAP e Total do orçamento.',
  ARRAY['fn_projetos_orcamento_eap_arvore','fn_projetos_orcamento_item_eap_listar']::text[],
  ARRAY['projetos_obras','erp_orcamentos','erp_orcamentos_itens']::text[],
  'parcial',
  'media',
  true,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM system_screens
  WHERE rota = '/dashboard/projetos/obras/[id]/orcamento/relatorios'
);
