-- Persistir o payload EXATO enviado à Focus na emissão de NF-e/NFC-e (decisão do CEO 23/09).
-- Espelho do que a NFS-e já faz (#90/#64 · erp_nfse_emitidas.payload_enviado): quando a SEFAZ
-- rejeita (ex.: 938 do ST retido, ou 232 de IE), hoje NÃO temos o corpo que foi enviado — a causa
-- só se reconstrói a partir do código do builder+provider (frágil, "no escuro"). Com esta coluna, a
-- rota grava o JSON efetivamente POSTado à Focus (nota AUTORIZADA ou REJEITADA), tornando a
-- depuração uma leitura do dado (RD-38: provar no dado, não supor).
--
-- SEM dado sensível novo: certificado e token vão no HEADER (não no corpo). O corpo tem
-- destinatário/itens/impostos — que já ficam persistidos em erp_nfe_emitidas (dados/itens). Não é
-- SECURITY DEFINER nem função: só ALTER TABLE ADD COLUMN, fora do gate check-fn-guards.

ALTER TABLE public.erp_nfe_emitidas
  ADD COLUMN IF NOT EXISTS payload_enviado jsonb;

COMMENT ON COLUMN public.erp_nfe_emitidas.payload_enviado IS
  'Corpo (JSON) efetivamente enviado ao provider (Focus) na emissão — sem cert/token (vão no header). '
  'Gravado pela rota após fn_registrar_nfe_emitida, inclusive em nota rejeitada, para depurar '
  'rejeições sem reconstruir o payload no escuro. Espelho de erp_nfse_emitidas.payload_enviado.';
