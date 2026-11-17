-- RD-98 p3 · /dashboard/ehs/epi/estoque · completa a ORIGEM DO DADO em system_screens.
-- Gap do auditor: rpcs_chamadas listava só fn_epi_registrar_entrega para >= 3 gravacoes da tela
--   (Entrada de estoque, Entregar EPI ao funcionario, Editar minimo) + a ajuda RD-95 — origem incompleta.
-- Cruzado com o codigo VIVO (src/app/dashboard/ehs/epi/estoque/page.tsx + _components/ModalEntregarEPI.tsx):
--   TABELAS: epi_estoque (leitura + Entrada + Editar minimo, gravacao direta), epi_catalogo (leitura),
--            v_epi_funcionarios_consolidado (leitura), epi_assinatura (gravada na entrega do EPI).
--   RPCS:    fn_epi_registrar_entrega (baixa na entrega), fn_ajuda_campo_listar / fn_ajuda_campo_uso (AjudaCampo, RD-95).
-- Esta migration torna a origem COMPLETA e honesta. As entradas e o "Editar minimo" gravam DIRETO em epi_estoque
-- (ja presente em views_consumidas) — por isso o completar e' via tabela (origem do dado), nao via RPC nova.
-- ADITIVA e IDEMPOTENTE: so metadado de tela (RD-98 p3), nao altera dado de cliente, nao mexe em RLS/fiscal/financeiro.
-- Padrao #3614 (UPDATE system_screens = catalogo aditivo; scripts/merge/migracao-catalogo.ts).

UPDATE public.system_screens
SET views_consumidas = ARRAY['epi_estoque','epi_catalogo','v_epi_funcionarios_consolidado','epi_assinatura']::text[],
    rpcs_chamadas    = ARRAY['fn_epi_registrar_entrega','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/ehs/epi/estoque';
