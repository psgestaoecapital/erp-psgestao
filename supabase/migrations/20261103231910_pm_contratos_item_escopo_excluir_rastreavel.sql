-- PDCA P&M · /dashboard/pm/contratos (aud8 82/95) — fecha o gap RD-98 p4: a EXCLUSÃO de item de ESCOPO do
-- contrato de fee (agency_contrato_itens) era um DELETE FÍSICO — sem deleted_at/deleted_by e sem audit_log.
-- Agora é SOFT-DELETE RASTREÁVEL (deleted_at + autor + audit_log_global), a listagem filtra deleted_at IS NULL e
-- há "desfazer" (restaurar) por quem excluiu/admin. Mesma doutrina da #3786 (fn_agency_proposta_excluir).
-- Também "?" (RD-95) nas ações que faltavam: ver/expandir escopo, vincular à GE, adicionar e excluir item do escopo.
--
-- SENSÍVEL: CREATE OR REPLACE de funções existentes (listar/realizado/excluir). Aditiva nas colunas (ADD IF NOT EXISTS),
-- não toca dado de cliente real nem título/parcela. RLS de agency_contrato_itens inalterada; REVOKE anon na função nova.
-- RD-38 provado em produção (BEGIN…ROLLBACK, statement_timeout 15s, DEMO P&M b0700000-…-0002, contrato 80e9acbc):
--   total físico 2 → vivos pós-exclusão 1 (filtro deleted_at IS NULL) · rastro deleted_at+deleted_by OK · linha física preservada.
-- RD-52: arquivo em supabase/migrations/, versão acima da main, segundos :10 (faixa do dev7). apply_migration NÃO usado.

-- 1) Colunas de rastro (aditiva, metadata-only; itens pré-existentes ficam vivos: deleted_at NULL) ─────────────
ALTER TABLE public.agency_contrato_itens ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.agency_contrato_itens ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) Exclusão rastreável (soft-delete + autor + audit_log_global) — mantém a assinatura (p_item_id, p_user) ─────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_item_excluir(p_item_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user);
  v_it  public.agency_contrato_itens%ROWTYPE;
BEGIN
  SELECT * INTO v_it FROM public.agency_contrato_itens WHERE id = p_item_id;
  IF v_it.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_it.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_it.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_excluido', true, 'id', p_item_id); END IF;

  UPDATE public.agency_contrato_itens
     SET deleted_at = now(), deleted_by = v_uid
   WHERE id = p_item_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_it.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'agency_contrato_itens', p_item_id::text, 'contrato_item_excluido',
     jsonb_build_object('tipo_servico', v_it.tipo_servico, 'quantidade_contratada', v_it.quantidade_contratada,
                        'unidade', v_it.unidade, 'periodicidade', v_it.periodicidade, 'contrato_id', v_it.contrato_id),
     jsonb_build_object('deleted_at', now(), 'deleted_by', v_uid));

  RETURN jsonb_build_object('ok', true, 'id', p_item_id);
END;
$function$;

-- 3) Desfazer a exclusão (restaurar) — só quem excluiu ou admin, e só item realmente excluído ──────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_item_restaurar(p_item_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user);
  v_it  public.agency_contrato_itens%ROWTYPE;
BEGIN
  SELECT * INTO v_it FROM public.agency_contrato_itens WHERE id = p_item_id;
  IF v_it.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_it.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_it.deleted_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_ativo', true, 'id', p_item_id); END IF;

  UPDATE public.agency_contrato_itens
     SET deleted_at = NULL, deleted_by = NULL
   WHERE id = p_item_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_it.company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
     'agency_contrato_itens', p_item_id::text, 'contrato_item_restaurado',
     jsonb_build_object('deleted_at', v_it.deleted_at, 'deleted_by', v_it.deleted_by),
     jsonb_build_object('restaurado_em', now(), 'restaurado_por', v_uid));

  RETURN jsonb_build_object('ok', true, 'id', p_item_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_item_restaurar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_item_restaurar(uuid, uuid) TO authenticated, service_role;

-- 4) Listagem filtra itens excluídos (itens_total, itens_a_mais, escopo_status) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_listar(p_company_id uuid)
 RETURNS TABLE(contrato_id uuid, cliente_nome text, erp_cliente_id uuid, proposta_id uuid, tipo text, fee_mensal numeric, ge_valor_mensal numeric, erp_contrato_id uuid, tem_contrato_ge boolean, status text, data_inicio date, itens_total integer, itens_a_mais integer, escopo_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
  SELECT c.id,
    COALESCE(ac.nome_fantasia, ac.nome, ec.nome_fantasia, ec.razao_social, '—'),
    c.erp_cliente_id, c.proposta_id, c.tipo,
    c.fee_mensal, gc.valor_atual, c.erp_contrato_id, (c.erp_contrato_id IS NOT NULL),
    c.status, c.data_inicio,
    (SELECT count(*)::int FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id AND ci.deleted_at IS NULL) AS itens_total,
    (SELECT count(*)::int FROM agency_contrato_itens ci
       CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, CURRENT_DATE) jn
       WHERE ci.contrato_id = c.id AND ci.deleted_at IS NULL AND ci.quantidade_contratada IS NOT NULL
         AND (SELECT count(*) FROM agency_jobs j
              WHERE j.contrato_id = c.id AND j.status NOT IN ('cancelado','cancelada')
                AND ((ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
                     OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))))
                AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
             ) > ci.quantidade_contratada) AS itens_a_mais,
    CASE WHEN (SELECT count(*) FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id AND ci.deleted_at IS NULL) = 0
         THEN 'sem_escopo' ELSE 'com_escopo' END AS escopo_status
  FROM agency_contratos c
  LEFT JOIN agency_clientes ac ON ac.id = c.cliente_id
  LEFT JOIN erp_clientes ec ON ec.id = c.erp_cliente_id
  LEFT JOIN erp_contratos gc ON gc.id = c.erp_contrato_id
  WHERE c.company_id = p_company_id
  ORDER BY c.criado_em DESC;
END;
$function$;

-- 5) Contratado × realizado ignora itens excluídos ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_realizado(p_contrato_id uuid, p_periodo_ref date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_itens jsonb; v_sem_servico jsonb;
BEGIN
  SELECT company_id INTO v_company FROM agency_contratos WHERE id = p_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_itens FROM (
    SELECT
      ci.id AS item_id, ci.servico_id, ci.tipo_servico,
      COALESCE(sv.nome, ci.tipo_servico) AS servico_nome,
      ci.quantidade_contratada, ci.unidade, ci.periodicidade,
      (ci.quantidade_contratada IS NULL) AS sem_limite,
      jn.ini AS periodo_ini, jn.fim AS periodo_fim,
      cnt.criados, cnt.entregues,
      CASE WHEN ci.quantidade_contratada IS NULL THEN NULL
           ELSE ci.quantidade_contratada - cnt.criados END AS saldo,
      CASE
        WHEN ci.quantidade_contratada IS NULL THEN 'sem_limite'
        WHEN cnt.criados > ci.quantidade_contratada THEN 'a_mais'
        WHEN cnt.criados = ci.quantidade_contratada THEN 'em_dia'
        ELSE 'a_menos' END AS situacao
    FROM agency_contrato_itens ci
    LEFT JOIN agency_servico sv ON sv.id = ci.servico_id
    CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, p_periodo_ref) jn
    CROSS JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE TRUE) AS criados,
        count(*) FILTER (WHERE j.status = 'publicado') AS entregues
      FROM agency_jobs j
      WHERE j.contrato_id = p_contrato_id
        AND j.status NOT IN ('cancelado','cancelada')
        AND (
          (ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
          OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico)))
        )
        AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
    ) cnt
    WHERE ci.contrato_id = p_contrato_id AND ci.deleted_at IS NULL
    ORDER BY ci.tipo_servico
  ) t;

  -- jobs sem serviço vinculado (servico_id nulo) — trabalho que some do controle
  SELECT jsonb_agg(jsonb_build_object('tipo', tp, 'qtd', qtd)) INTO v_sem_servico FROM (
    SELECT COALESCE(NULLIF(lower(btrim(tipo)),''),'(sem tipo)') tp, count(*) qtd
    FROM agency_jobs j
    WHERE j.contrato_id = p_contrato_id AND j.servico_id IS NULL
      AND j.status NOT IN ('cancelado','cancelada')
    GROUP BY 1 ORDER BY 2 DESC
  ) x;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id,
    'periodo_ref', p_periodo_ref,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'jobs_sem_servico', COALESCE(v_sem_servico, '[]'::jsonb));
END;
$function$;

-- 6) RD-95: "?" das ações que faltavam (texto em erp_ajuda_campo; idempotente) ────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/contratos', 'pm', 'publicado'
FROM (VALUES
 ('pm.contratos.acao_ver_escopo', 'Contratos · Ações', 'Ver escopo / contratado × realizado',
  'Ação (não é campo): a pílula ao lado do fee abre e fecha o detalhe do escopo — o contratado × realizado por serviço no mês.',
  'Mostra, sem sair da lista, se cada serviço do contrato está em dia, abaixo ou acima do que foi contratado.',
  'Clicar em "escopo · 2 itens" para ver Carrossel e Reels do mês.',
  'Confundir com "Editar escopo": esta só mostra; para mudar os itens use "Editar escopo".',
  22),
 ('pm.contratos.acao_vincular_ge', 'Contratos · Ações', 'Vincular à Gestão Empresarial',
  'Ação (não é campo): liga o fee ao contrato oficial da Gestão Empresarial (onde ficam o PDF, a vigência e o faturamento).',
  'Enquanto o fee não está vinculado, ele não fatura; vincular traz o valor do fee da fonte única (a GE).',
  'Clicar no aviso "sem contrato na GE — vincular" e escolher o contrato da empresa.',
  'Deixar o fee sem vínculo achando que já fatura: sem contrato na GE ele fica fora do faturamento e do MRR.',
  23),
 ('pm.contratos.escopo_adicionar', 'Contratos · Escopo', 'Adicionar item ao escopo',
  'Ação (não é campo): grava um novo item do contrato (serviço, quantidade, unidade e periodicidade) no escopo do fee.',
  'Cada item vira uma linha do contratado × realizado — é o que o sistema compara com os jobs produzidos.',
  'Adicionar "8 Carrossel/mês" ao escopo.',
  'Salvar sem nomear o serviço: o nome do item é obrigatório (o catálogo é opcional, para o de-para).',
  24),
 ('pm.contratos.escopo_excluir', 'Contratos · Escopo', 'Excluir item do escopo',
  'Ação (não é campo): remove um item do escopo. A exclusão é rastreável (soft-delete): o item some da lista, fica o registro de quem e quando, e dá para desfazer.',
  'Tira do controle um serviço que não faz mais parte do contrato, sem perder o histórico (auditoria).',
  'Excluir "Reels" quando o cliente deixou de contratar esse serviço.',
  'Achar que apaga de vez: o item é só marcado como excluído (auditável) e pode ser restaurado pelo botão Desfazer.',
  25),
 ('pm.contratos.escopo_desfazer', 'Contratos · Escopo', 'Desfazer exclusão',
  'Ação (não é campo): restaura o último item de escopo que você excluiu nesta tela.',
  'Corrige uma exclusão por engano sem precisar recadastrar o item.',
  'Clicar em "Desfazer" logo após excluir o item errado.',
  'Esperar desfazer item excluído por outra pessoa: o Desfazer vale para a exclusão feita agora, nesta sessão.',
  26)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;

-- 7) check_fn_guards: REVOKE anon/GRANT nas 3 funções SECURITY DEFINER recriadas (ajuste revisor #3840) ────────
-- ACL viva já é {authenticated,service_role} (sem anon); estas linhas apenas reafirmam o estado atual, não mudam acesso.
REVOKE ALL ON FUNCTION public.fn_agency_contrato_item_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_item_excluir(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_listar(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_realizado(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_realizado(uuid, date) TO authenticated, service_role;
