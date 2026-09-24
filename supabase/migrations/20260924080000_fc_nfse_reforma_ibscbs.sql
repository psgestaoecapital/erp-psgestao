-- FC PISOS (b202b50f) — IBS/CBS (Reforma Tributária) na NFS-e Nacional.
--
-- Provado no dado (RD-38): o payload_enviado das tentativas da FC NÃO tinha as chaves ibs_cbs_* porque
-- reforma_ibs_cbs_cst / reforma_ibs_cbs_classif_trib estavam NULL. O caminho de código já é completo e
-- opt-in: /api/fiscal/nfse/emitir lê esses campos da config e só seta nfseReq.reforma quando ao menos um
-- está preenchido (route.ts ~L434); buildNacionalNFSePayload então emite ibs_cbs_situacao_tributaria +
-- ibs_cbs_classificacao_tributaria. Config vazia → grupo NÃO sai. O layout nacional v2.0 exige o grupo
-- IBS/CBS (presente na NF 418 autorizada da FC/VOSSKO: CST 000 / cClassTrib 000001) — sem ele a nota
-- reprovaria depois dos 4 consertos (#1769). Os valores/alíquotas/BC do grupo são APURADOS pelo Sistema
-- Nacional a partir da classificação (CST/cClassTrib) + valor + local; o emitente declara a classificação.
--
-- FONTE: NF 418 autorizada (FC PISOS → VOSSKO/Lages). Classificação por empresa/serviço — o contador
-- confirma se 000/000001 é a classificação padrão dos serviços da FC (pisos/revestimentos industriais).
update public.erp_fiscal_provider_config
  set reforma_ibs_cbs_cst = '000',
      reforma_ibs_cbs_classif_trib = '000001'
  where company_id = 'b202b50f-37cb-462e-accf-126869de49f0'
    and reforma_ibs_cbs_cst is null
    and reforma_ibs_cbs_classif_trib is null;
