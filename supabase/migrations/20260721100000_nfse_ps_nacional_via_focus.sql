-- NFS-e PS · emissão no formato NFSe Nacional VIA FOCUS (/v2/nfsen) — correção de rumo (suporte Focus:
-- ajustar o JSON na emissão via Focus, NÃO migrar pro gov.br direto). O provider ATIVO segue focusnfe.
-- O código (focusnfe.ts + rota) monta o layout nacional quando o município do prestador aderiu.
--
-- Aqui só o permanente: a flag do município 4217204 (São Miguel do Oeste/SC) = aderido.
-- (O routing pra homologação é operacional/temporário, aplicado por fora via MCP.)
UPDATE public.erp_gov_nfse_municipios SET aderido=true, atualizado_em=now() WHERE codigo_ibge='4217204';
INSERT INTO public.erp_gov_nfse_municipios (codigo_ibge, nome_municipio, uf, aderido, data_adesao, observacoes)
SELECT '4217204','São Miguel do Oeste','SC', true, '2026-01-01', 'Adesão NFSe Nacional confirmada pela Focus (PS).'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_gov_nfse_municipios WHERE codigo_ibge='4217204');
