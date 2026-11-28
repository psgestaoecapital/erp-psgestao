-- Hub · HB0 (tela 30) · RD-38: reconcilia o baseline de 2 correções da fotografia de 09/10 que JÁ foram
-- resolvidas em produção, mas cujas linhas do blueprint_tela_requisito seguiam 'ausente' (o dashboard/dev
-- subestima o progresso do Hub). Provado no dado + no código:
--
-- 1) "Conectores (ERPs)" no menu do Hub levava a /dashboard/industrial/conectores (home da GE):
--    JÁ CORRIGIDO pela migration 20261023161045_hub_menu_conectores_rota_certa.sql — o Hub tem módulo
--    próprio hub_conectores_erp apontando para /dashboard/conectores (página existe: src/app/dashboard/
--    conectores/page.tsx), e admin_conectores_erp saiu de surface_in_groups 'hub'.
-- 2) O item "Acompanhamento" abria a mesma tela de "Resultado por obra":
--    JÁ CORRIGIDO — /dashboard/projetos/acompanhamento é hoje a lente de ANDAMENTO (portfólio/cronograma),
--    distinta do Resultado (financeiro), com RPC própria fn_obras_acompanhamento (chamado #3742).
--
-- Apenas metadado de produto (blueprint); NÃO toca dado de cliente, estrutura, RLS, policy nem grant.
-- Idempotente (UPDATE guardado por status_baseline <> 'atendido' + rota exata). RD-52: arquivo + PR, acima
-- da main, faixa desenvolvedor_4_g (segundos :45). Code: desenvolvedor_4_g

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'Reconciliação RD-38 (23/11): corrigido pela migration 20261023161045 — o Hub tem módulo próprio hub_conectores_erp → /dashboard/conectores (página existe); admin_conectores_erp removido de surface_in_groups hub.'
 WHERE vertical = 'hub_projetos'
   AND tela_num = 30
   AND rota_padrao = '/dashboard/industrial/conectores'
   AND status_baseline <> 'atendido';

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'Reconciliação RD-38 (23/11): /dashboard/projetos/acompanhamento é hoje a lente de ANDAMENTO (portfólio/cronograma, fn_obras_acompanhamento, chamado #3742), distinta de Resultado por obra (financeiro) — não há tela duplicada.'
 WHERE vertical = 'hub_projetos'
   AND tela_num = 30
   AND rota_padrao = '/dashboard/projetos/acompanhamento'
   AND status_baseline <> 'atendido';
