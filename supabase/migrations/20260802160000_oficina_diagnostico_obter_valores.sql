-- RD-41 · Oficina 🅰️ — valores sempre visíveis na OS (correção-raiz).
-- BUG (KGF OS-2026-0018, Jordana): após aprovar, os valores somem da tela de Diagnóstico.
-- RAIZ (RD-51/38): o DADO existe (6 itens com preco + aprovado=true), mas
-- fn_oficina_diagnostico_obter NÃO devolvia preco/aprovado/subtotal. A tela não tinha o que mostrar.
-- Correção: a MESMA RPC (RD-26, sem paralela) passa a devolver, por item, preco/subtotal/aprovado/
-- aprovado_em/status_item + um resumo (total_aprovado/total_geral + contagens). Valor SEMPRE vem —
-- a tela decide como exibir (recusado sem valor é decisão de exibição).
-- FRONTEIRA GE: isto é o ORÇAMENTO operacional da OS (precificação do serviço), NÃO o faturamento.

CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_obter(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH itens AS (
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
             'preco', i.preco, 'subtotal', i.subtotal,
             'aprovado', i.aprovado, 'aprovado_em', i.aprovado_em, 'status_item', i.status_item,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade,
             'observacao', i.observacao) ORDER BY i.ordem, i.created_at)
           FROM itens i), '[]'::jsonb),
    'resumo', (SELECT jsonb_build_object(
             'total_aprovado', COALESCE(SUM(subtotal) FILTER (WHERE status_item='aprovado'), 0),
             'total_geral',    COALESCE(SUM(subtotal), 0),
             'qtd_aprovados',  COUNT(*) FILTER (WHERE status_item='aprovado'),
             'qtd_pendentes',  COUNT(*) FILTER (WHERE status_item='pendente'),
             'qtd_recusados',  COUNT(*) FILTER (WHERE status_item='recusado'))
           FROM itens)
  );
$function$;

-- Apontamento: continua listando os SERVIÇOS aprovados (apontáveis por hora) e passa a
-- devolver também as PEÇAS aprovadas como CONTEXTO (read-only, sem hora e SEM R$ — a tela do
-- mecânico é 🚫 R$). Assim o mecânico vê o ESCOPO aprovado completo (fim do "não mostra os itens").
CREATE OR REPLACE FUNCTION public.fn_oficina_apontamento_obter(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca, 'modelo', o.modelo)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'item_id', i.id, 'servico_id', i.servico_id, 'descricao', i.descricao,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade,
             'apontamento', (SELECT jsonb_build_object('id', a.id, 'status', a.status,
                    'tempo_real_h', a.tempo_real_h, 'iniciado_em', a.iniciado_em,
                    'finalizado_em', a.finalizado_em, 'mecanico_nome', a.mecanico_nome)
                  FROM erp_os_apontamento a
                  WHERE a.diagnostico_item_id = i.id AND a.company_id = p_company_id
                  ORDER BY a.created_at DESC LIMIT 1))
             ORDER BY i.ordem, i.created_at)
           FROM erp_os_diagnostico_item i
           WHERE i.os_id = p_os_id AND i.company_id = p_company_id
             AND i.tipo = 'servico' AND i.aprovado IS TRUE), '[]'::jsonb),
    'pecas', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'item_id', i.id, 'descricao', i.descricao, 'quantidade', i.quantidade) ORDER BY i.ordem, i.created_at)
           FROM erp_os_diagnostico_item i
           WHERE i.os_id = p_os_id AND i.company_id = p_company_id
             AND i.tipo = 'peca' AND i.aprovado IS TRUE), '[]'::jsonb)
  );
$function$;
