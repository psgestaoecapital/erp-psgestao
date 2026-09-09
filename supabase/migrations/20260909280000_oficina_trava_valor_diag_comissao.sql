-- ============================================================
-- Oficina · Wave B.2 · trava de valor no Diagnostico (§3.2)
-- SPEC "Oficina · Papeis do dono e do mecanico" (09/09). Continuacao do B.1 (papeis + lista de OS).
--
-- Decisao do CEO (09/09), §3.2: o mecanico ve o Diagnostico SEM preco nos itens e SEM total.
-- Gancho: fn_oficina_papel(company) = 'OFICINA_MECANICO'. Trava NA RPC (nao na tela).
-- RESIDUO (mesmo do B.1, erp_contexto_projeto 72fcbdcf): a RLS ainda deixa erp_os_diagnostico_item.
-- preco passar por PostgREST direto; endurecimento e a Onda A. As telas passam por esta RPC.
--
-- ─────────────────────────────────────────────────────────────
-- FORA DESTE ARQUIVO — Comissao O1 (mecanico ve so a propria): BLOQUEADO POR ACHADO DE DADO (RD-38).
-- fn_oficina_comissao_calcular agrupa por mecanico_nome (texto). Tentei filtrar por
-- mecanico_id = auth.uid(), MAS auditoria provou que mecanico_id do apontamento e QUEM REGISTROU,
-- nao quem trabalhou: no KGF, o usuario c468a5fe (Gean) tem 31 dos 37 apontamentos, sob 8
-- mecanico_nome distintos — ele lanca a producao de varios mecanicos digitando o nome. Logo
-- "a propria comissao" NAO e derivavel de mecanico_id. Precisa de decisao do CEO sobre a identidade
-- do mecanico (login proprio por mecanico + registro do proprio apontamento, ou um mapa
-- usuario->mecanico_nome). Ate la, a tela de Comissao fica fora do alcance do mecanico (nao expor),
-- em vez de mostrar dado errado. Registrado para o CEO.
-- ─────────────────────────────────────────────────────────────
-- ============================================================

-- DIAGNOSTICO: omite preco/subtotal dos itens e os totais do resumo para o mecanico.
-- Mantem item, quantidade, tempo, severidade e status de aprovacao (o que ele precisa pra executar).
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_obter(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH f AS (SELECT (public.fn_oficina_papel(p_company_id) = 'OFICINA_MECANICO') AS mec),
  itens AS (
    SELECT i.*,
      ROUND(COALESCE(i.preco,0) * COALESCE(i.quantidade,1), 2) AS subtotal,
      CASE WHEN i.aprovado IS TRUE THEN 'aprovado'
           WHEN i.aprovado IS FALSE AND i.aprovado_em IS NOT NULL THEN 'recusado'
           ELSE 'pendente' END AS status_item
    FROM erp_os_diagnostico_item i
    WHERE i.os_id = p_os_id AND i.company_id = p_company_id
  )
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object(
             'id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca,
             'modelo', o.modelo, 'ano', o.ano, 'km', o.km,
             'defeito_relatado', o.defeito_relatado, 'diagnostico', o.diagnostico)
           FROM erp_os o
           WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'tipo', i.tipo, 'servico_id', i.servico_id, 'produto_id', i.produto_id,
             'descricao', i.descricao, 'quantidade', i.quantidade,
             -- TRAVA DE VALOR (§3.2): mecanico nao recebe preco nem subtotal.
             'preco',    CASE WHEN (SELECT mec FROM f) THEN NULL ELSE i.preco END,
             'subtotal', CASE WHEN (SELECT mec FROM f) THEN NULL ELSE i.subtotal END,
             'aprovado', i.aprovado, 'aprovado_em', i.aprovado_em, 'status_item', i.status_item,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade,
             'observacao', i.observacao) ORDER BY i.ordem, i.created_at)
           FROM itens i), '[]'::jsonb),
    'resumo', (SELECT jsonb_build_object(
             -- os totais tambem sao valor: nulos para o mecanico.
             'total_aprovado', CASE WHEN (SELECT mec FROM f) THEN NULL ELSE COALESCE(SUM(subtotal) FILTER (WHERE status_item='aprovado'), 0) END,
             'total_geral',    CASE WHEN (SELECT mec FROM f) THEN NULL ELSE COALESCE(SUM(subtotal), 0) END,
             'qtd_aprovados',  COUNT(*) FILTER (WHERE status_item='aprovado'),
             'qtd_pendentes',  COUNT(*) FILTER (WHERE status_item='pendente'),
             'qtd_recusados',  COUNT(*) FILTER (WHERE status_item='recusado'))
           FROM itens)
  );
$function$;
