-- ============================================================
-- Fiscal · Origem da nota (chamado #18, decisões §6 do CEO) — fundação da "uma porta"
-- ============================================================
-- A nota passa a guardar origem_tipo + origem_id: é o que costura a nota à vertical E ao Fiscal SEM
-- duplicar, e resolve a NF-e nº 9 do KGF (devolução de compra AUTORIZADA e invisível por não ter âncora).
-- Decisões do CEO:
--  §6.2 origem_tipo com CHECK nos 6 valores que já existem (não vira texto livre; vertical nova acrescenta).
--  §6.3 backfill derivado das colunas que JÁ EXISTEM. As 4 colunas antigas NÃO são removidas (RD-30) —
--       ficam como legado; origem_tipo/origem_id passa a ser a FONTE.
-- (§6.1 redireciona×fila e a troca das telas das verticais vêm no PR de UI; aqui é só o dado.)

DO $mig$
DECLARE v_check text := $c$ CHECK (origem_tipo IS NULL OR origem_tipo IN ('os','obra','pedido','venda','devolucao_compra','avulsa')) $c$;
BEGIN
  -- NFS-e
  ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS origem_tipo text;
  ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS origem_id uuid;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_nfse_emitidas_origem_tipo_chk') THEN
    EXECUTE 'ALTER TABLE public.erp_nfse_emitidas ADD CONSTRAINT erp_nfse_emitidas_origem_tipo_chk ' || v_check;
  END IF;
  -- NF-e
  ALTER TABLE public.erp_nfe_emitidas ADD COLUMN IF NOT EXISTS origem_tipo text;
  ALTER TABLE public.erp_nfe_emitidas ADD COLUMN IF NOT EXISTS origem_id uuid;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_nfe_emitidas_origem_tipo_chk') THEN
    EXECUTE 'ALTER TABLE public.erp_nfe_emitidas ADD CONSTRAINT erp_nfe_emitidas_origem_tipo_chk ' || v_check;
  END IF;
END $mig$;

COMMENT ON COLUMN public.erp_nfse_emitidas.origem_tipo IS
  'De onde a nota nasceu: os|obra|pedido|venda|devolucao_compra|avulsa. Fonte (as colunas os_id/pedido_id/obra_id/erp_receber_id ficam como legado).';
COMMENT ON COLUMN public.erp_nfe_emitidas.origem_tipo IS
  'De onde a nota nasceu: os|obra|pedido|venda|devolucao_compra|avulsa. Fonte (as colunas os_id/pedido_id/erp_receber_id/chave_referenciada ficam como legado).';

-- ------------------------------------------------------------
-- §6.3 BACKFILL — deriva das colunas existentes. Prioridade explícita (uma nota pode ter mais de uma âncora).
-- ------------------------------------------------------------
-- NFS-e: os_id → os · pedido_id → pedido · obra_id → obra · erp_receber_id sozinho → venda · nada → avulsa
UPDATE public.erp_nfse_emitidas SET
  origem_tipo = CASE
    WHEN os_id IS NOT NULL THEN 'os'
    WHEN pedido_id IS NOT NULL THEN 'pedido'
    WHEN obra_id IS NOT NULL THEN 'obra'
    WHEN erp_receber_id IS NOT NULL THEN 'venda'
    ELSE 'avulsa' END,
  origem_id = COALESCE(os_id, pedido_id, obra_id, erp_receber_id)
WHERE origem_tipo IS NULL;

-- NF-e: finalidade=devolucao + chave_referenciada → devolucao_compra (é a nº 9 do KGF) ·
--       os_id → os · pedido_id → pedido · erp_receber_id sozinho → venda · nada → avulsa
UPDATE public.erp_nfe_emitidas SET
  origem_tipo = CASE
    WHEN finalidade = 'devolucao' AND COALESCE(btrim(chave_referenciada),'') <> '' THEN 'devolucao_compra'
    WHEN finalidade = 'devolucao' THEN 'devolucao_compra'
    WHEN os_id IS NOT NULL THEN 'os'
    WHEN pedido_id IS NOT NULL THEN 'pedido'
    WHEN erp_receber_id IS NOT NULL THEN 'venda'
    ELSE 'avulsa' END,
  -- devolucao_compra referencia a COMPRA por chave (texto), não por uuid → origem_id nulo nesse caso
  origem_id = CASE WHEN finalidade = 'devolucao' THEN NULL
                   ELSE COALESCE(os_id, pedido_id, erp_receber_id) END
WHERE origem_tipo IS NULL;

-- ------------------------------------------------------------
-- fn_listar_nfes_emitidas · devolve origem_tipo/origem_id (a tela do Fiscal passa a mostrar a origem —
-- e a nº 9 aparece com origem_tipo='devolucao_compra'). Só ACRESCENTA colunas ao retorno (aditivo).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_listar_nfes_emitidas(p_company_id uuid, p_status text DEFAULT NULL::text, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_busca text DEFAULT NULL::text, p_finalidade text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, numero text, serie text, chave text, data_emissao timestamp with time zone, destinatario_razao_social text, destinatario_cnpj text, destinatario_cpf text, valor_total numeric, valor_icms numeric, valor_ipi numeric, natureza_operacao text, finalidade text, chave_referenciada text, status text, motivo_rejeicao text, protocolo text, xml_url text, danfe_url text, xml_storage_path text, danfe_storage_path text, provider_reference text, criado_em timestamp with time zone, origem_tipo text, origem_id uuid, total_geral bigint)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT * FROM erp_nfe_emitidas n
    WHERE n.company_id = p_company_id
      AND (p_status IS NULL OR n.status = p_status)
      AND (p_finalidade IS NULL OR n.finalidade = p_finalidade)
      AND (p_data_inicio IS NULL OR n.data_emissao >= p_data_inicio::timestamptz)
      AND (p_data_fim IS NULL OR n.data_emissao <= (p_data_fim + 1)::timestamptz)
      AND (p_busca IS NULL OR p_busca = '' OR
           n.destinatario_razao_social ILIKE '%' || p_busca || '%' OR
           n.numero ILIKE '%' || p_busca || '%' OR
           n.chave ILIKE '%' || p_busca || '%' OR
           n.destinatario_cnpj ILIKE '%' || p_busca || '%')
  )
  SELECT
    b.id, b.numero, b.serie, b.chave, b.data_emissao,
    b.destinatario_razao_social, b.destinatario_cnpj, b.destinatario_cpf,
    b.valor_total, b.valor_icms, b.valor_ipi,
    b.natureza_operacao, b.finalidade, b.chave_referenciada,
    b.status, b.motivo_rejeicao, b.protocolo,
    b.xml_url, b.danfe_url, b.xml_storage_path, b.danfe_storage_path,
    b.provider_reference, b.criado_em, b.origem_tipo, b.origem_id,
    (SELECT COUNT(*) FROM base)::bigint AS total_geral
  FROM base b
  ORDER BY b.data_emissao DESC NULLS LAST, b.criado_em DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
