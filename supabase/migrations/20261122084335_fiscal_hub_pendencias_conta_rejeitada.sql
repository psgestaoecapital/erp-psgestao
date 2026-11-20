-- PDCA GE · /dashboard/fiscal · GAP 1 (CRÍTICO, correctness/compliance)
-- Problema (RD-38, provado em produção 2026-11-20):
--   v_hub_fiscal_cards conta erros/pendências só com status='erro', que NUNCA ocorre
--   em erp_nfse_emitidas/erp_nfe_emitidas. Os status reais são:
--   autorizada, rejeitada, cancelada, processando. Rejeição do SEFAZ = 'rejeitada'.
--   -> total_erros é estruturalmente 0: nota rejeitada (precisa correção/reemissão)
--      fica INVISÍVEL no Hub Fiscal e o card pinta VERDE "tudo certo" (falso-zero).
--   Volume escondido hoje: 58 NFS-e + 50 NF-e 'rejeitada' no sistema
--   (PS GESTAO 25305b15-...: 5 NFS-e rejeitadas, hub mostrava total_erros=0).
-- Correção: os buckets de erro/pendência passam a contar 'erro' E 'rejeitada'
--   (mantém 'erro'/'processando' caso surjam). Aditiva: só muda os FILTER de contagem
--   de erro; colunas, ordem e tipos idênticos (preserva grants/consumidores).
--   Único consumidor: fn_hub_fiscal_resumo(uuid) (lê os campos da view) + HubFiscalClient.
-- Validação pós-deploy: PS GESTAO deve passar a mostrar 5 em "com erro".

CREATE OR REPLACE VIEW public.v_hub_fiscal_cards AS
 WITH nfse_stats AS (
         SELECT erp_nfse_emitidas.company_id,
            count(*) AS total,
            count(*) FILTER (WHERE erp_nfse_emitidas.status = 'autorizada'::text) AS autorizadas,
            count(*) FILTER (WHERE erp_nfse_emitidas.status = 'processando'::text) AS processando,
            count(*) FILTER (WHERE erp_nfse_emitidas.status = ANY (ARRAY['erro'::text, 'rejeitada'::text])) AS erros,
            count(*) FILTER (WHERE erp_nfse_emitidas.status = 'cancelada'::text) AS canceladas,
            count(*) FILTER (WHERE erp_nfse_emitidas.status = 'autorizada'::text AND erp_nfse_emitidas.data_emissao >= date_trunc('month'::text, now())) AS autorizadas_mes,
            COALESCE(sum(erp_nfse_emitidas.valor_servicos) FILTER (WHERE erp_nfse_emitidas.status = 'autorizada'::text), 0::numeric) AS valor_total_autorizadas,
            COALESCE(sum(erp_nfse_emitidas.valor_servicos) FILTER (WHERE erp_nfse_emitidas.status = 'autorizada'::text AND erp_nfse_emitidas.data_emissao >= date_trunc('month'::text, now())), 0::numeric) AS valor_total_mes
           FROM erp_nfse_emitidas
          GROUP BY erp_nfse_emitidas.company_id
        ), nfe_stats AS (
         SELECT erp_nfe_emitidas.company_id,
            count(*) AS total,
            count(*) FILTER (WHERE erp_nfe_emitidas.status = 'autorizada'::text) AS autorizadas,
            count(*) FILTER (WHERE erp_nfe_emitidas.status = 'processando'::text) AS processando,
            count(*) FILTER (WHERE erp_nfe_emitidas.status = ANY (ARRAY['erro'::text, 'rejeitada'::text])) AS erros,
            count(*) FILTER (WHERE erp_nfe_emitidas.status = 'cancelada'::text) AS canceladas,
            count(*) FILTER (WHERE erp_nfe_emitidas.status = 'autorizada'::text AND erp_nfe_emitidas.data_emissao >= date_trunc('month'::text, now())) AS autorizadas_mes,
            COALESCE(sum(erp_nfe_emitidas.valor_total) FILTER (WHERE erp_nfe_emitidas.status = 'autorizada'::text), 0::numeric) AS valor_total_autorizadas,
            COALESCE(sum(erp_nfe_emitidas.valor_total) FILTER (WHERE erp_nfe_emitidas.status = 'autorizada'::text AND erp_nfe_emitidas.data_emissao >= date_trunc('month'::text, now())), 0::numeric) AS valor_total_mes
           FROM erp_nfe_emitidas
          GROUP BY erp_nfe_emitidas.company_id
        ), config_status AS (
         SELECT erp_fiscal_provider_config.company_id,
            erp_fiscal_provider_config.ativo AS focus_configurado,
            erp_fiscal_provider_config.ambiente,
            erp_fiscal_provider_config.proxima_numeracao_nfse,
            erp_fiscal_provider_config.proxima_numeracao_nfe
           FROM erp_fiscal_provider_config
          WHERE erp_fiscal_provider_config.ativo = true
        )
 SELECT c.id AS company_id,
    c.razao_social,
    c.nome_fantasia,
    COALESCE(ns.total, 0::bigint) AS nfse_total,
    COALESCE(ns.autorizadas, 0::bigint) AS nfse_autorizadas,
    COALESCE(ns.processando, 0::bigint) AS nfse_processando,
    COALESCE(ns.erros, 0::bigint) AS nfse_erros,
    COALESCE(ns.autorizadas_mes, 0::bigint) AS nfse_autorizadas_mes,
    COALESCE(ns.valor_total_autorizadas, 0::numeric) AS nfse_valor_total,
    COALESCE(ns.valor_total_mes, 0::numeric) AS nfse_valor_mes,
    COALESCE(ne.total, 0::bigint) AS nfe_total,
    COALESCE(ne.autorizadas, 0::bigint) AS nfe_autorizadas,
    COALESCE(ne.processando, 0::bigint) AS nfe_processando,
    COALESCE(ne.erros, 0::bigint) AS nfe_erros,
    COALESCE(ne.autorizadas_mes, 0::bigint) AS nfe_autorizadas_mes,
    COALESCE(ne.valor_total_autorizadas, 0::numeric) AS nfe_valor_total,
    COALESCE(ne.valor_total_mes, 0::numeric) AS nfe_valor_mes,
    COALESCE(ns.processando, 0::bigint) + COALESCE(ne.processando, 0::bigint) AS total_processando,
    COALESCE(ns.erros, 0::bigint) + COALESCE(ne.erros, 0::bigint) AS total_erros,
    COALESCE(cs.focus_configurado, false) AS focus_configurado,
    cs.ambiente,
    cs.proxima_numeracao_nfse,
    cs.proxima_numeracao_nfe
   FROM companies c
     LEFT JOIN nfse_stats ns ON ns.company_id = c.id
     LEFT JOIN nfe_stats ne ON ne.company_id = c.id
     LEFT JOIN config_status cs ON cs.company_id = c.id;

COMMENT ON VIEW public.v_hub_fiscal_cards IS
  'Cards do Hub Fiscal (/dashboard/fiscal). Buckets de erro/pendência contam status erro E rejeitada (SEFAZ) — nota rejeitada precisa correção/reemissão e não pode ficar invisível. PDCA GE 2026-11-20.';

-- RD-95: ajusta o "?" do card Pendências para refletir que notas rejeitadas contam
-- e que o card agora é clicável (abre a lista filtrada para resolver). Idempotente.
UPDATE public.erp_ajuda_campo
   SET para_que_serve = 'Soma das notas que ainda não fecharam: as que estão processando (aguardando a SEFAZ/prefeitura) mais as rejeitadas ou com erro, que precisam de correção e reemissão. Clique para abrir a lista filtrada e resolver.',
       exemplo        = '5 pendências · 0 processando · 5 rejeitadas.',
       erro_comum     = 'Nota rejeitada/com erro não se resolve sozinha: clique no card, abra a NF-e/NFS-e correspondente e corrija o motivo da rejeição para reemitir.'
 WHERE chave = 'ge.fiscal.hub.pendencias';
