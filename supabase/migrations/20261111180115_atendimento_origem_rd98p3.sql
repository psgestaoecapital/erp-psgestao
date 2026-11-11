-- Atendimento (/dashboard/atendimento) — RD-98 p3 (origem do dado): fecha o gap que segura o selo (aud8, score 80).
--
-- Gap do auditor: system_screens.views_consumidas e rpcs_chamadas VAZIOS para a rota — os 68+
-- selados têm a origem preenchida, então sem isto a tela não ganha o selo, mesmo com a UI pronta
-- (7 "?" RD-95 publicados em erp_ajuda_campo + estados vazios contextuais por aba já no código).
--
-- Esta migration é ADITIVA e IDEMPOTENTE — só metadado de catálogo (system_screens). Nenhum dado de
-- cliente, schema, RLS, policy ou permissão é tocado.
--
-- Valores extraídos do código vivo de src/app/dashboard/atendimento/page.tsx (RD-38):
--   .from()  -> sugestoes, sugestao_anexo, users
--   .rpc()   -> fn_chamado_equipe_listar, fn_chamado_historico
--   AjudaCampo (src/components/ajuda/AjudaCampo.tsx) -> fn_ajuda_campo_listar, fn_ajuda_campo_uso
--
-- Prova RD-38 (BEGIN/ROLLBACK, statement_timeout curto) rodada antes do PR:
--   ANTES: n_views=0, n_rpcs=0, estado_real='desconhecida'
--   DEPOIS: n_views=3, n_rpcs=4, estado_real='pronto'
-- Code: dev7claudeps

UPDATE public.system_screens SET
  views_consumidas = ARRAY['sugestoes','sugestao_anexo','users']::text[],
  rpcs_chamadas = ARRAY[
    'fn_chamado_equipe_listar','fn_chamado_historico',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[],
  estado_real = 'pronto',
  atualizado_em = now()
WHERE rota = '/dashboard/atendimento';
