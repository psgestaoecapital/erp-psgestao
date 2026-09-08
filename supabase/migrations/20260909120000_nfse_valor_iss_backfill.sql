-- ============================================================
-- #32 · grava o valor_iss que foi ao fisco mas nao ficou na nossa tabela
-- Bug de gravacao (nao fiscal): o insert da edge gov-nfse-emitir nunca setava valor_iss, embora o
-- MESMO valor (valor_servicos x aliquota/100) fosse enviado no DPS e transcrito no XML autorizado.
-- Resultado: 67 notas autorizadas com valor_iss NULL na nossa base, enquanto a prefeitura tem o ISS.
-- Aqui corrigimos SO as que tinham aliquota > 0 (o ISS destacado real) — o valor autorizado.
-- As de aliquota 0 ficam de fora: essas sairam com ISS zero no proprio XML e sao retificacao
-- fiscal (decisao do contador), nao gravacao nossa. Idempotente: so onde valor_iss ainda e NULL.
-- ============================================================
UPDATE public.erp_nfse_emitidas
   SET valor_iss = round(valor_servicos * aliquota_iss / 100.0, 2)
 WHERE status = 'autorizada'
   AND valor_iss IS NULL
   AND aliquota_iss IS NOT NULL AND aliquota_iss > 0
   AND valor_servicos IS NOT NULL;
