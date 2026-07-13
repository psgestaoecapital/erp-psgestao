-- ============================================================
-- HIGIENE · credencial IO Point DUPLICADA da Tryo Gessos (918c3ea4).
--
-- Diagnóstico 13/07/2026 (RD-44b): a Tryo Gessos tinha DUAS credenciais
-- iopoint ativas em erp_credencial:
--   • 8974257b · "IO Point · API Key"  · secret iopoint_api_key_918c3ea4-…  ← EM USO
--       (é o vault_secret_name que ind_ponto_provider_config aponta; o sync funciona por ela)
--   • 331f4f17 · "IO Point Tryo Gesso"  · secret IOPOINT_TOKEN_TRYO_GESSOS   ← ÓRFÃ
--       (nenhum provider_config referencia esse secret)
--
-- NÃO é vazamento (cada empresa tem token próprio, escopo empresa, RLS ativo —
-- ver RD-45). É só redundância. Desativamos a ÓRFÃ (ativo=false, RD-30: não
-- deletar, só mudar status — reversível). O secret no Vault não é tocado aqui.
--
-- GUARDA: só desativa a credencial cujo secret NÃO é referenciado por nenhum
-- provider_config ativo da MESMA empresa. Assim é impossível derrubar o token
-- em uso, e roda 0 linhas em ambientes onde a linha não existe (idempotente).
-- ============================================================

UPDATE erp_credencial c
SET ativo = false,
    atualizado_em = now()
WHERE c.provider = 'iopoint'
  AND c.company_id = '918c3ea4-770d-4a10-9200-f9c21f92a1f6'
  AND c.ativo = true
  AND NOT EXISTS (
    SELECT 1 FROM ind_ponto_provider_config p
    WHERE p.company_id = c.company_id
      AND p.ativo = true
      AND p.vault_secret_name = c.nome_secret_vault
  );
