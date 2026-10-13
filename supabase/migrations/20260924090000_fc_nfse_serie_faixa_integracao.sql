-- Reversão da série da FC + faixa por TIPO DE EMISSOR (correção CEO 24/09, RD-38).
--
-- A NFS-e Nacional tem FAIXAS DE SÉRIE por TIPO DE EMISSOR:
--   • Portal Nacional (Ambiente Gerador = Portal): faixa própria (ex.: 70000 — foi a série da NF 418, que
--     saiu PELO PORTAL).
--   • INTEGRAÇÃO (nosso caso, emissão via Focus): faixa 00001–49999.
--
-- O #1769 (migration 20260924070000) setou serie_nfse_padrao=70000 na FC por dedução de contexto equivocada
-- (peguei a série da NF 418 e assumi ser a nossa — mas aquela nota saiu pelo PORTAL, e nós emitimos por
-- INTEGRAÇÃO). O E0010 daquele dia NÃO era série errada nossa — era série de portal aplicada à integração.
-- Os 15000 que já estavam configurados estavam CERTOS. A Jordana reverteu o painel Focus para 15000; isto
-- realinha o NOSSO cadastro. Fonte: correção do CEO 24/09.
update public.erp_fiscal_provider_config set serie_nfse_padrao = '15000'
  where company_id = 'b202b50f-37cb-462e-accf-126869de49f0' and serie_nfse_padrao = '70000';
