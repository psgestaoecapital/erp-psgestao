-- Fiscal/NFe Recebida · #11a: manifestação individual (ciência / confirmar / recusar). Fronteira GE (Pilar 1).
--
-- Premissa corrigida (RD-38/RD-51): o SPEC supôs que faltavam (a) os estados finais no
-- CHECK de status_manifestacao e (b) um RPC Postgres que "dispara o evento no Focus".
-- Auditoria empírica:
--   • O CHECK JÁ aceita os 5 estados (pendente/ciencia/confirmada/desconhecida/nao_realizada) —
--     nada a alterar aqui.
--   • A manifestação é um EVENTO oficial ao SEFAZ via Focus (HTTP). Um RPC SECURITY DEFINER não
--     faz essa chamada (token no Vault, sem HTTP em SQL). O evento fica na edge nfe-manifestar
--     (espelha a auth JWT/RLS da nfe-distribuicao). RD-58: o status só muda se o Focus aceitar.
--
-- A ÚNICA mudança de schema que o #11a exige é registrar QUEM manifestou (o SPEC pede "+ quem fez"),
-- ao lado do manifestado_em já existente. A escrita do status + manifestado_em + manifestado_por
-- acontece na edge (service role), só após o evento ser aceito pelo Focus.

ALTER TABLE public.erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS manifestado_por uuid;

COMMENT ON COLUMN public.erp_nfe_recebidas.manifestado_por IS
  'Usuário que disparou a manifestação (ciência/confirmação/desconhecimento/não realizada) via edge nfe-manifestar. Gravado só após o Focus aceitar o evento (RD-58).';
