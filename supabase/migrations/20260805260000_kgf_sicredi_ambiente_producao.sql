-- RD-41 · KGF/Gean Auto Mecânica (a462e13f) — vira o perfil Sicredi (748) de HOMOLOGAÇÃO para PRODUÇÃO.
-- Autorização explícita do CEO: a KGF já testou boletos de valor simbólico; liberar remessa real.
--
-- FIX 2 (agência no header — CRÍTICO, RD-38): o gerador CNAB tira a agência do header (posições 53-57 =
-- agCoop) do campo `cooperativa` ('0313'), NÃO do campo `agencia` (que estava NULL). Confirmado em
-- mapearRemessaSicredi (empresa.agCoop = soDigitos(cfg.cooperativa)) + buildArquivoSicredi (HEADER_ARQ.agCoop).
-- Ainda assim populamos `agencia='0313'` aqui por HIGIENE/auditoria: o registro passa a bater com o arquivo
-- real (6YT63101, agência 00313) e some o "agencia IS NULL" que assustava. O gerador continua lendo cooperativa.
--
-- ⚠️ EFEITO COLATERAL (mesma linha serve cobrança e pagamento): com ambiente='producao', a API de COBRANÇA
-- Sicredi (registrar boleto) passa a apontar para o host de PRODUÇÃO (src/lib/banco/sicredi: base() troca
-- '/sb' por produção). As credenciais no Vault precisam ser as de PRODUÇÃO para o boleto continuar emitindo.
UPDATE public.erp_banco_provider_config
   SET ambiente   = 'producao',
       agencia    = '0313',
       updated_at = now()
 WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND provider   = 'sicredi';
