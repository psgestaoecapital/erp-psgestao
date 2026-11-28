-- #11040 (MECÂNICA PESADA E BORRACHARIA 163 · Guarujá do Sul/SC · Focus NFe · produção) — NFS-e rejeitava no
-- cTribMun: "The value '140101' is not accepted by the pattern '[0-9]{3}'" (xpath /DPS/infDPS/serv/cServ/cTribMun).
--
-- Causa raiz PROVADA no dado: o emissor (src/app/api/fiscal/nfse/emitir/route.ts) só marca padraoNacional=true
-- quando erp_gov_nfse_municipios.aderido = true para o município do prestador. Guarujá do Sul (IBGE 4206603)
-- estava com aderido = NULL → o emissor NÃO ia para o buildNacionalNFSePayload (que NÃO manda cTribMun) e caía no
-- builder MUNICIPAL (ABRASF), que preenche codigo_tributario_municipio = código de serviço = "140101" (o código
-- NACIONAL de 6 dígitos). Como o município É aderido ao Nacional, a Focus valida a nota contra o schema Nacional
-- (DPS) e rejeita o cTribMun (que exige [0-9]{3}).
--
-- Comparação: São Miguel do Oeste (4217204, onde a Gean/Kgf emite AUTORIZADO pelo mesmo provedor) está aderido=true
-- ("Adesão à NFSe Nacional confirmada pela Focus … Flag corrigida") e emite pelo buildNacionalNFSePayload, SEM
-- cTribMun. A própria Focus validando a DPS da 163 confirma a adesão de Guarujá do Sul.
--
-- Conserto (mesma correção já aplicada à SMO): marcar Guarujá do Sul como aderido → o emissor roteia a 163 pelo
-- MESMO builder nacional da Gean (sem cTribMun). Aditivo e idempotente: UPDATE por codigo_ibge numa tabela de
-- REFERÊNCIA GLOBAL (cache de municípios aderidos ao Nacional), não é dado de cliente. Só liga a flag de rota.

UPDATE public.erp_gov_nfse_municipios
   SET aderido = true,
       observacoes = 'Adesão à NFSe Nacional confirmada pela Focus (o schema Nacional valida a DPS do município) — chamado #11040. Flag corrigida (estava NULL), para rotear pelo builder nacional (sem cTribMun), igual à SMO.',
       atualizado_em = now()
 WHERE codigo_ibge = '4206603' AND coalesce(aderido, false) IS DISTINCT FROM true;
