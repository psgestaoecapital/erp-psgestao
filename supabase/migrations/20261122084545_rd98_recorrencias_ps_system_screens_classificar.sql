-- RD-98 p3 · /dashboard/contratos/recorrencias-ps: rota com estado_real='desconhecida' (nao
-- classificada) e rpcs_chamadas sem a RPC fn_ajuda_campo_uso (o AjudaCampo chama listar E uso).
--
-- A tela esta funcional (prova no codigo, RD-38 — src/app/dashboard/contratos/recorrencias-ps/page.tsx):
--   views: v_contratos_dashboard (:51), erp_contratos (:52), erp_clientes (:307) — ja registradas.
--   CRUD por RPC: fn_contrato_acoes_permitidas (:175), fn_contrato_editar (:197),
--     fn_contrato_encerrar (:201), fn_contrato_excluir (:205), fn_contrato_preview_cronograma (:331),
--     fn_contrato_recorrencia_criar (:356) — ja registradas.
--   ajuda "?": AjudaCampo -> fn_ajuda_campo_listar (ja registrada) E fn_ajuda_campo_uso (FALTAVA).
--
-- Correcao corretiva e idempotente (so metadado de registro; nao toca RLS, dado de cliente nem
-- comportamento): classifica a rota como 'parcial' e acrescenta fn_ajuda_campo_uso sem remover
-- nada ja presente (array_cat + dedup).

UPDATE public.system_screens s
   SET estado_real   = 'parcial',
       rpcs_chamadas = (
         SELECT array_agg(DISTINCT r)
         FROM unnest(COALESCE(s.rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_ajuda_campo_uso']) AS r
       ),
       atualizado_em = now()
 WHERE s.rota = '/dashboard/contratos/recorrencias-ps';
