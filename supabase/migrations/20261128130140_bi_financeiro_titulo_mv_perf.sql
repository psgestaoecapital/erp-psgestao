-- P0 · BI Financeiro da Diretoria (/dashboard/inteligencia/financeiro) não carregava: statement timeout.
-- code-desenvolvedor-3 (núcleo/backend) · molde do BI PS de 3 camadas (igual #6200 comercial_venda_item_mv).
--
-- CAUSA (RD-38, provado no dado): fn_bi_financeiro_painel → fn_bi_financeiro_montar chama fn_ind_fin_titulo
-- UMA vez (t0 MATERIALIZED), que faz o parse de ~18 campos do jsonb `raw` para CADA uma das 70.052 linhas
-- financeiras de ind_atak_fato (tabela de 1518 MB) a CADA carga do painel. O custo do parse jsonb em volume
-- estoura o statement_timeout da diretora.
--
-- FIX (padrão BI PS): materializar a projeção TIPADA numa MV (ind_fin_titulo_mv) com índices; fn_ind_fin_titulo
-- passa a LER da MV (sem parse jsonb em tempo de consulta). A MV é refrescada CONCURRENTLY ao fim de cada
-- importação ATAK (edge function atak-ingest, domínios financeiro_receber/pagar). A CLASSIFICAÇÃO
-- (ind_fin_classificacao → natureza/imposto) é aplicada a JUSANTE em fn_bi_financeiro_montar, em tempo de
-- consulta — NÃO entra na MV; por isso salvar regra NÃO exige refresh (a MV só muda quando o dado bruto muda).
--
-- SEGURANÇA: MV com dado financeiro sensível → REVOKE anon/authenticated/PUBLIC; só o painel (SECURITY DEFINER,
-- guarda de empresa + papel direção) lê. Projeção IDÊNTICA à fn atual (mesmas expressões, só renomeadas),
-- validada em amostra ao centavo (RD-38). Aditiva: nenhuma tabela/dado de cliente alterado.
-- "## Base legal — não se aplica: leitura gerencial (não é documento fiscal nem DRE contábil)."

-- ── 1) MV: projeção tipada das 70k linhas financeiras (sem parse jsonb na leitura) ──────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.ind_fin_titulo_mv;
CREATE MATERIALIZED VIEW public.ind_fin_titulo_mv AS
  SELECT
    f.id,
    f.company_id,
    'atak'::text AS origem,
    CASE f.dominio WHEN 'financeiro_receber' THEN 'receber' ELSE 'pagar' END AS ramo,
    f.chave_fato AS chave,
    CASE f.raw->>'TITULO.STATUS TITULO' WHEN 'A' THEN 'aberto' WHEN 'L' THEN 'liquidado' WHEN 'C' THEN 'cancelado' ELSE 'outro' END AS status,
    left(f.raw->>'TITULO.DATA EMISSAO', 10)::date AS emissao,
    left(f.raw->>'TITULO.DATA VENCTO', 10)::date AS vencimento,
    CASE WHEN f.raw->>'TITULO.STATUS TITULO' = 'L' THEN left(f.raw->>'DATA RECEBIMENTO', 10)::date END AS baixa,
    coalesce((f.raw->>'VALOR TITULO')::numeric, 0) AS valor,
    CASE WHEN f.raw->>'TITULO.STATUS TITULO' = 'L'
         THEN coalesce((f.raw->>'VALOR RECEBIMENTO')::numeric, (f.raw->>'VALOR TITULO')::numeric, 0) ELSE 0 END AS valor_baixa,
    CASE WHEN f.raw->>'TITULO.STATUS TITULO' = 'A' THEN coalesce((f.raw->>'VALOR SALDO')::numeric, 0) ELSE 0 END AS saldo,
    coalesce(f.raw->>'CLIENTE.COD CLIENTE', f.raw->>'FORNECEDOR.COD CLIENTE') AS parceiro_cod,
    left(trim(coalesce(f.raw->>'CLIENTE.NOME CADASTRO', f.raw->>'FORNECEDOR.NOME CADASTRO', 'Sem nome')), 60) AS parceiro,
    nullif(nullif(trim(f.raw->>'NOME_GRUPO_ECONOMICO'), ''), '0') AS grupo,
    coalesce(nullif(trim(f.raw->>'NOME_FORMA_CP'), ''), 'Não definida') AS forma,
    coalesce(nullif(trim(f.raw->>'TITULO.COD DOCTO'), ''), '—') AS documento,
    nullif(trim(f.raw->>'NOME_CARTEIRA'), '') AS carteira,
    nullif(trim(f.raw->>'FILIAL.APELIDO FILIAL'), '') AS filial,
    f.imported_at AS importado_em
  FROM public.ind_atak_fato f
  WHERE f.dominio IN ('financeiro_receber', 'financeiro_pagar')
WITH DATA;

-- UNIQUE (id): exigido por REFRESH ... CONCURRENTLY. (company_id, ramo): filtro de fn_ind_fin_titulo.
CREATE UNIQUE INDEX ind_fin_titulo_mv_id_uidx ON public.ind_fin_titulo_mv (id);
CREATE INDEX ind_fin_titulo_mv_company_ramo_idx ON public.ind_fin_titulo_mv (company_id, ramo);

-- Dado financeiro sensível: ninguém lê a MV direto; só o painel SECURITY DEFINER.
REVOKE ALL ON public.ind_fin_titulo_mv FROM PUBLIC, anon, authenticated;

-- ── 2) Meta de frescor (atualizado por quem refresca) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ind_fin_titulo_mv_meta (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  linhas        bigint NOT NULL DEFAULT 0
);
INSERT INTO public.ind_fin_titulo_mv_meta (id, atualizado_em, linhas)
  VALUES (true, now(), (SELECT count(*) FROM public.ind_fin_titulo_mv))
  ON CONFLICT (id) DO UPDATE SET atualizado_em = excluded.atualizado_em, linhas = excluded.linhas;
REVOKE ALL ON public.ind_fin_titulo_mv_meta FROM PUBLIC, anon, authenticated;
-- RLS ligada sem policy: só SECURITY DEFINER / service_role acessam (linha global, sem dado de cliente).
ALTER TABLE public.ind_fin_titulo_mv_meta ENABLE ROW LEVEL SECURITY;

-- ── 3) Refresh CONCURRENTLY (chamado pela atak-ingest ao fim da importação financeira) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_fin_titulo_mv_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n bigint;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ind_fin_titulo_mv;
  SELECT count(*) INTO v_n FROM public.ind_fin_titulo_mv;
  UPDATE public.ind_fin_titulo_mv_meta SET atualizado_em = now(), linhas = v_n WHERE id;
  RETURN jsonb_build_object('ok', true, 'linhas', v_n, 'atualizado_em', now());
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ind_fin_titulo_mv_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ind_fin_titulo_mv_refresh() TO service_role;

-- ── 4) fn_ind_fin_titulo passa a LER da MV (mesma assinatura, mesmas colunas, mesma ordem) ────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_fin_titulo(p_company_id uuid, p_ramo text DEFAULT NULL::text)
 RETURNS TABLE(origem text, ramo text, chave text, status text, emissao date, vencimento date, baixa date, valor numeric, valor_baixa numeric, saldo numeric, parceiro_cod text, parceiro text, grupo text, forma text, documento text, carteira text, filial text, importado_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.origem, m.ramo, m.chave, m.status, m.emissao, m.vencimento, m.baixa,
         m.valor, m.valor_baixa, m.saldo, m.parceiro_cod, m.parceiro, m.grupo,
         m.forma, m.documento, m.carteira, m.filial, m.importado_em
  FROM public.ind_fin_titulo_mv m
  WHERE m.company_id = p_company_id
    AND (p_ramo IS NULL OR p_ramo = 'ambos' OR m.ramo = p_ramo)
$function$;
REVOKE ALL ON FUNCTION public.fn_ind_fin_titulo(uuid, text) FROM PUBLIC, anon, authenticated;
