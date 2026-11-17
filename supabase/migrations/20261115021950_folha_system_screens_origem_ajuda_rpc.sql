-- RD-98 p3 (origem do dado): a rota /dashboard/industrial/folha já tem a linhagem de dados
-- (views folha_competencia/folha_verba; rpc fn__pode_ver_folha), mas faltava a RPC do "?" da tela.
-- A tela usa <AjudaCampo> (AjudaCampo.tsx -> fn_ajuda_campo_listar) nos 9 campos/colunas/KPIs.
-- Aditivo e idempotente: só acrescenta fn_ajuda_campo_listar quando ainda não está na lista.
UPDATE public.system_screens
SET rpcs_chamadas = (
      SELECT ARRAY(SELECT DISTINCT unnest(coalesce(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_listar']::text[]))
    ),
    atualizado_em = now()
WHERE rota = '/dashboard/industrial/folha'
  AND NOT ('fn_ajuda_campo_listar' = ANY(coalesce(rpcs_chamadas, ARRAY[]::text[])));
