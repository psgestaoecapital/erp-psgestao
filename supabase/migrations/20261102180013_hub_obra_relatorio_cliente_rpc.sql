-- Relatório ao cliente da obra — RPC de resumo (só leitura)
-- META CEO 02/11 · Gestão de Obras · tela 297 (Relatório ao cliente / PDF) e apoio à tela 296 (Portal)
-- Code: desenvolvedor_5_g
--
-- Função read-only que consolida, para UMA obra, o resumo que vai ao cliente:
-- cabeçalho da obra, avanço (pct_conclusao), medições faturadas (valor_medido),
-- e contagens do diário (dias de RDO, fotos) e de medições/avanço por item.
-- NÃO expõe custo interno nem margem (dado do escritório), só o que o cliente
-- pode ver (avanço, fotos, medições) — coerente com H9.
--
-- Segurança: SECURITY INVOKER — a RLS de projetos_obras/RDO/avanço (por empresa,
-- get_user_company_ids) já restringe; guarda de empresa explícita e redundante
-- no WHERE. REVOKE anon. Aditiva (função nova; sem escrita).

CREATE OR REPLACE FUNCTION public.fn_obra_relatorio_cliente(p_obra_id uuid)
RETURNS TABLE (
  obra_id           uuid,
  numero            text,
  nome              text,
  cliente_nome      text,
  status            text,
  endereco          text,
  cidade            text,
  uf                text,
  data_inicio       date,
  data_prevista_fim date,
  pct_conclusao     integer,
  valor_previsto    numeric,
  valor_medido      numeric,
  dias_diario       integer,
  fotos_total       integer,
  medicoes_total    integer,
  gerado_em         timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id, o.numero, o.nome, o.cliente_nome, o.status,
    o.endereco, o.cidade, o.uf,
    o.data_inicio, o.data_prevista_fim,
    o.pct_conclusao, o.valor_previsto, o.valor_medido,
    (SELECT count(*)::int
       FROM public.projetos_obra_rdo r
      WHERE r.obra_id = o.id AND r.excluido_em IS NULL),
    (SELECT COALESCE(sum(COALESCE(array_length(r.fotos, 1), 0)), 0)::int
       FROM public.projetos_obra_rdo r
      WHERE r.obra_id = o.id AND r.excluido_em IS NULL),
    (SELECT count(*)::int
       FROM public.projetos_obra_tarefa_avanco a
      WHERE a.obra_id = o.id),
    now()
  FROM public.projetos_obras o
  WHERE o.id = p_obra_id
    AND o.deleted_at IS NULL
    AND (o.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
$$;

REVOKE ALL ON FUNCTION public.fn_obra_relatorio_cliente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_relatorio_cliente(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_obra_relatorio_cliente(uuid) IS
  'Resumo só-leitura da obra para o relatório ao cliente (tela 297) / portal (296): cabeçalho, avanço, medições e contagens do diário. Sem custo interno. Escopo por empresa via RLS (SECURITY INVOKER).';
