-- RD-98 pilar 3 (ORIGEM DO DADO): preencher system_screens.views_consumidas / rpcs_chamadas
-- da tela Portal do cliente — acesso (/dashboard/projetos/obras/[id]/portal-cliente).
-- Gap apontado pelo PDCA (auditor_pdca_1, 08/11): catálogo NULL impede o selo no pilar 3.
-- A tela (src/app/dashboard/projetos/obras/[id]/portal-cliente/page.tsx) consome, provado no fonte:
--   view  : projetos_obras (.from('projetos_obras'))
--   rpcs  : fn_obra_cliente_acesso_listar / _conceder / _revogar (.rpc(...))
--           fn_ajuda_campo_listar (componente AjudaCampo — "?" RD-95)
-- Migration ADITIVA e IDEMPOTENTE: só metadados de catálogo; nunca toca dado de cliente.
-- Code: code-desenvolvedor-3

UPDATE public.system_screens
SET views_consumidas = ARRAY['projetos_obras']::text[],
    rpcs_chamadas = ARRAY[
      'fn_obra_cliente_acesso_listar',
      'fn_obra_cliente_acesso_conceder',
      'fn_obra_cliente_acesso_revogar',
      'fn_ajuda_campo_listar'
    ]::text[]
WHERE rota = '/dashboard/projetos/obras/[id]/portal-cliente';
