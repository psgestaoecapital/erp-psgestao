-- FC PISOS E REVESTIMENTOS INDUSTRIAIS LTDA (company b202b50f-37cb-462e-accf-126869de49f0) —
-- correções de cadastro fiscal p/ NFS-e Nacional, PROVADAS no payload_enviado das tentativas rejeitadas
-- (erp_nfse_emitidas, RD-38) e na NF 418 autorizada (VOSSKO/Lages, R$ 98.165,70).
--
-- E0116 "A IM deve ser informada para o emitente prestador...": mandávamos inscricao_municipal=6617, que é
-- o "Indicador Municipal (Inscrição)", NÃO a IM. A IM real registrada no CNC do município é 162268088
-- (confirmada na NF 418).
update public.companies set inscricao_municipal = '162268088'
  where id = 'b202b50f-37cb-462e-accf-126869de49f0' and inscricao_municipal = '6617';

-- E0037 (município emissor): Iporã do Oeste (4207650) ESTÁ no Sistema Nacional (NF 418: ambGer=2 Sistema
-- Nacional, tpAmb=1 produção). gov_nfse_municipio_aderido estava false — mas era o DEFAULT da coluna,
-- NUNCA consultado (gov_nfse_ultima_consulta_municipio = null). Foi esse false-por-default que levou a um
-- diagnóstico anterior errado ("não aderido / AtendeNet"). Marca true e registra a confirmação manual.
update public.erp_fiscal_provider_config
  set gov_nfse_municipio_aderido = true,
      gov_nfse_ultima_consulta_municipio = now()
  where company_id = 'b202b50f-37cb-462e-accf-126869de49f0'
    and gov_nfse_municipio_codigo = '4207650';

-- E0010 (série fora da faixa): ALINHAMENTO DE REGISTRO apenas. ATENÇÃO — o payload nacional NÃO envia
-- série (buildNacionalNFSePayload; provado: payload_enviado.serie = null nas tentativas). A faixa de série
-- efetiva é a configurada no PAINEL FOCUS da empresa (a real é 70000; lá estava 15000). Esta linha só
-- mantém nosso cadastro coerente com a realidade — a correção que REMOVE o E0010 é feita no Focus.
update public.erp_fiscal_provider_config set serie_nfse_padrao = '70000'
  where company_id = 'b202b50f-37cb-462e-accf-126869de49f0' and serie_nfse_padrao = '15000';
