-- NFS-e PS · emissão no formato NFSe Nacional VIA FOCUS (/v2/nfsen) — correção de rumo (suporte Focus:
-- ajustar o JSON na emissão via Focus, NÃO migrar pro gov.br direto). O provider ATIVO segue focusnfe.
-- O código (focusnfe.ts + rota) monta o layout nacional quando o município do prestador aderiu.
--
-- Aqui só o permanente (o routing pra homologação é operacional/temporário, aplicado por fora):
--   (1) Flag do município 4217204 (São Miguel do Oeste/SC) = aderido (Focus confirmou adesão).
--   (2) percentual_total_tributos_sn na config focusnfe da PS (totTrib obrigatório no schema ADN p/ Simples
--       Nacional ME/EPP) — o valor 8.55 já estava na config gov; replicado pra focusnfe (provider ativo).

UPDATE public.erp_gov_nfse_municipios SET aderido=true, atualizado_em=now() WHERE codigo_ibge='4217204';
INSERT INTO public.erp_gov_nfse_municipios (codigo_ibge, nome_municipio, uf, aderido, data_adesao, observacoes)
SELECT '4217204','São Miguel do Oeste','SC', true, '2026-01-01', 'Adesão NFSe Nacional confirmada pela Focus (PS).'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_gov_nfse_municipios WHERE codigo_ibge='4217204');

UPDATE public.erp_fiscal_provider_config
   SET percentual_total_tributos_sn='8.55', updated_at=now()
 WHERE company_id='b26c19c0-bf6d-495b-b8d1-9fa8d6896725' AND provider='focusnfe'
   AND percentual_total_tributos_sn IS NULL;
