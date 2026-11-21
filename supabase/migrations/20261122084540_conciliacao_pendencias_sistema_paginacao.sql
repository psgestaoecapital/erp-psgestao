-- PDCA GE · /dashboard/financeiro/conciliacao (aba "Pendências do Sistema") · auditor_pdca_2 17/11
-- Gap (RD-98): a aba lista as pendências do sistema (títulos de erp_pagar/erp_receber ainda não
--   vinculados ao extrato) com teto fixo de 200 e SEM paginação. Na flagship DEMO "Comércio (GE)"
--   há 30.362 pendências — o usuário enxerga 0,7% e não há como ver o resto.
-- Correção aditiva: novo parâmetro p_offset (DEFAULT 0) + OFFSET, para o front paginar (prev/next).
--   A ORDER BY ganha desempate determinístico (tabela, id) — sem ele, LIMIT/OFFSET sobre datas
--   repetidas poderia repetir/pular linhas entre páginas.
-- Compatibilidade: p_offset é o ÚLTIMO parâmetro e tem DEFAULT, então toda chamada posicional de 5
--   argumentos que já existe (ex.: fn_consultor_raiox chama (company, NULL, NULL, NULL, 500))
--   continua resolvendo para esta função com p_offset = 0 — sem quebrar callers.
-- Não toca dado de cliente, não mexe em RLS. Função é SECURITY INVOKER (RLS da sessão vale) e
--   filtra por company_id. ACL explícita abaixo.

DROP FUNCTION IF EXISTS public.fn_conciliacao_pendencias_sistema(uuid, text, date, date, integer);

CREATE OR REPLACE FUNCTION public.fn_conciliacao_pendencias_sistema(
  p_company_id uuid,
  p_natureza   text    DEFAULT NULL::text,
  p_data_ini   date    DEFAULT NULL::date,
  p_data_fim   date    DEFAULT NULL::date,
  p_limite     integer DEFAULT 200,
  p_offset     integer DEFAULT 0)
 RETURNS TABLE(tabela text, id uuid, natureza text, nome text, descricao text, categoria text, valor numeric, data_vencimento date, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT 'erp_pagar'::text AS tabela, p.id, 'debito'::text AS natureza,
           p.fornecedor_nome AS nome, p.descricao, p.categoria,
           p.valor, p.data_vencimento, p.status
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) p
    WHERE p.company_id = p_company_id
      AND (p_natureza IS NULL OR p_natureza = 'debito')
      AND coalesce(p.status, '') <> 'cancelado'
      AND (p_data_ini IS NULL OR p.data_vencimento >= p_data_ini)
      AND (p_data_fim IS NULL OR p.data_vencimento <= p_data_fim)
      AND NOT EXISTS (
        SELECT 1 FROM conciliacao_vinculo v
         WHERE v.lancamento_tabela = 'erp_pagar' AND v.lancamento_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM conciliacao_movimento m
         WHERE m.lancamento_tabela = 'erp_pagar'
           AND m.lancamento_id = p.id
           AND m.status = 'conciliado'
      )
    UNION ALL
    SELECT 'erp_receber'::text, r.id, 'credito'::text,
           r.cliente_nome, r.descricao, r.categoria,
           r.valor, r.data_vencimento, r.status
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) r
    WHERE r.company_id = p_company_id
      AND (p_natureza IS NULL OR p_natureza = 'credito')
      AND coalesce(r.status, '') <> 'cancelado'
      AND (p_data_ini IS NULL OR r.data_vencimento >= p_data_ini)
      AND (p_data_fim IS NULL OR r.data_vencimento <= p_data_fim)
      AND NOT EXISTS (
        SELECT 1 FROM conciliacao_vinculo v
         WHERE v.lancamento_tabela = 'erp_receber' AND v.lancamento_id = r.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM conciliacao_movimento m
         WHERE m.lancamento_tabela = 'erp_receber'
           AND m.lancamento_id = r.id
           AND m.status = 'conciliado'
      )
  ) x
  ORDER BY data_vencimento DESC NULLS LAST, tabela, id
  LIMIT p_limite OFFSET GREATEST(p_offset, 0);
$function$;

-- ACL explícita (mantém o comportamento anterior: authenticated + service_role; nunca anon)
REVOKE ALL ON FUNCTION public.fn_conciliacao_pendencias_sistema(uuid, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_pendencias_sistema(uuid, text, date, date, integer, integer) TO authenticated, service_role;

-- RD-95: "?" do controle de paginação da aba "Pendências do Sistema"
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'financeiro.conciliacao.paginacao_sistema', '/dashboard/financeiro/conciliacao', 'Pendências do Sistema', 'Paginação',
  'Nada a preencher: use "Anterior" e "Próxima" para navegar entre as páginas das pendências.',
  'A lista mostra as pendências em páginas de 200 por vez (empresas com muito movimento têm milhares). Use os botões para ver as demais sem perder o filtro e o período escolhidos.',
  'Está na página 1 e quer ver as pendências mais antigas: clique em "Próxima" até chegar nelas.',
  'Achar que só existem as 200 da tela — se "Próxima" está ativo, há mais pendências nas páginas seguintes.',
  'gestao_empresarial', 90, 1, 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
