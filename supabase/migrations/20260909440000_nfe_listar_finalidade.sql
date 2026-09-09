-- ============================================================
-- NF-e emitidas · lista ganha FINALIDADE (filtro + coluna no retorno) — pedido do CEO (09/09)
-- Problema: a devolucao (finalidade='devolucao') APARECE na lista, mas nao da pra IDENTIFICAR nem
-- FILTRAR — a RPC devolvia natureza mas nao finalidade/chave_referenciada. "Sem o filtro por
-- finalidade ninguem audita as devolucoes do mes." (Uma lista, sem tela nova — nao vira zoologico.)
--
-- Muda o RETURNS TABLE (adiciona finalidade + chave_referenciada), entao exige DROP + CREATE
-- (CREATE OR REPLACE nao permite alterar o tipo de retorno). Novo param p_finalidade (default NULL).
-- Nenhum dependente no banco (a lista e chamada pelo front via rpc, por nome). O selo "Devolucao" na
-- tela usa a coluna finalidade agora disponivel.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_listar_nfes_emitidas(uuid, text, date, date, text, integer, integer);

CREATE OR REPLACE FUNCTION public.fn_listar_nfes_emitidas(
  p_company_id uuid,
  p_status text DEFAULT NULL::text,
  p_data_inicio date DEFAULT NULL::date,
  p_data_fim date DEFAULT NULL::date,
  p_busca text DEFAULT NULL::text,
  p_finalidade text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE(id uuid, numero text, serie text, chave text, data_emissao timestamp with time zone,
   destinatario_razao_social text, destinatario_cnpj text, destinatario_cpf text,
   valor_total numeric, valor_icms numeric, valor_ipi numeric, natureza_operacao text,
   finalidade text, chave_referenciada text,
   status text, motivo_rejeicao text, protocolo text, xml_url text, danfe_url text,
   xml_storage_path text, danfe_storage_path text, provider_reference text,
   criado_em timestamp with time zone, total_geral bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    b.provider_reference, b.criado_em,
    (SELECT COUNT(*) FROM base)::bigint AS total_geral
  FROM base b
  ORDER BY b.data_emissao DESC NULLS LAST, b.criado_em DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
