-- P&M · Eventos & Produções — passo 3 (CEO 31/10): itens/fornecedores + checklist do evento.
-- Depende de agency_eventos (já em produção, #3621). Tudo ADITIVO e multi-tenant (RD-45): tabelas/RPCs novas,
-- nenhum dado de cliente tocado. Escrita só pelas RPCs (SECURITY DEFINER, guarda por empresa do evento,
-- audit_log_global, soft-delete RD-98 p4). Leitura por company_id (RLS). Sem anon. "?" (RD-95) nos campos/ações.

-- ============================================================= 1) Tabelas novas
CREATE TABLE IF NOT EXISTS public.agency_evento_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evento_id uuid NOT NULL REFERENCES public.agency_eventos(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  categoria text,                         -- ex.: locação, equipe, alimentação, transporte
  fornecedor text,                        -- nome livre do fornecedor (cadastro formal fica para a GE)
  quantidade numeric NOT NULL DEFAULT 1 CHECK (quantidade >= 0),
  valor_unitario numeric NOT NULL DEFAULT 0 CHECK (valor_unitario >= 0),
  valor_total numeric GENERATED ALWAYS AS (round(coalesce(quantidade,0) * coalesce(valor_unitario,0), 2)) STORED,
  status text NOT NULL DEFAULT 'a_contratar' CHECK (status IN ('a_contratar','contratado','entregue','cancelado')),
  observacao text,
  ordem int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz,
  excluido_em timestamptz,
  excluido_por uuid,
  excluido_motivo text
);
CREATE INDEX IF NOT EXISTS idx_agency_evento_item_evento ON public.agency_evento_item (evento_id) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.agency_evento_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evento_id uuid NOT NULL REFERENCES public.agency_eventos(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  concluido boolean NOT NULL DEFAULT false,
  prazo date,
  ordem int NOT NULL DEFAULT 0,
  concluido_em timestamptz,
  concluido_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz,
  excluido_em timestamptz,
  excluido_por uuid,
  excluido_motivo text
);
CREATE INDEX IF NOT EXISTS idx_agency_evento_chk_evento ON public.agency_evento_checklist (evento_id) WHERE excluido_em IS NULL;

ALTER TABLE public.agency_evento_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_evento_checklist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_evento_item'::regclass AND polname='agency_evento_item_sel') THEN
    CREATE POLICY agency_evento_item_sel ON public.agency_evento_item
      FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_evento_checklist'::regclass AND polname='agency_evento_chk_sel') THEN
    CREATE POLICY agency_evento_chk_sel ON public.agency_evento_checklist
      FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
REVOKE ALL ON public.agency_evento_item FROM PUBLIC, anon;
REVOKE ALL ON public.agency_evento_checklist FROM PUBLIC, anon;
GRANT SELECT ON public.agency_evento_item TO authenticated;
GRANT SELECT ON public.agency_evento_checklist TO authenticated;

-- ============================================================= 2) RPCs (guarda pela empresa do evento)
-- helper inline: resolve a empresa do evento e confere acesso. Retorna company_id ou NULL (sem acesso/inexistente).

CREATE OR REPLACE FUNCTION public.fn_pm_evento_item_salvar(p_evento_id uuid, p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_comp uuid; v_id uuid; v_ant agency_evento_item%ROWTYPE;
  v_desc text := nullif(btrim(p_dados->>'descricao'),'');
  v_cat text := nullif(btrim(p_dados->>'categoria'),'');
  v_forn text := nullif(btrim(p_dados->>'fornecedor'),'');
  v_obs text := nullif(btrim(p_dados->>'observacao'),'');
  v_status text := COALESCE(nullif(btrim(p_dados->>'status'),''),'a_contratar');
  v_qtd numeric := COALESCE(nullif(p_dados->>'quantidade','')::numeric, 1);
  v_vu numeric := COALESCE(nullif(p_dados->>'valor_unitario','')::numeric, 0);
  v_ordem int := COALESCE(nullif(p_dados->>'ordem','')::int, 0);
BEGIN
  SELECT company_id INTO v_comp FROM agency_eventos WHERE id = p_evento_id AND excluido_em IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','evento não encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_desc IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','a descrição do item é obrigatória'); END IF;
  IF v_status NOT IN ('a_contratar','contratado','entregue','cancelado') THEN RETURN jsonb_build_object('ok',false,'erro','status inválido'); END IF;
  IF v_qtd < 0 OR v_vu < 0 THEN RETURN jsonb_build_object('ok',false,'erro','quantidade e valor não podem ser negativos'); END IF;

  IF p_id IS NULL THEN
    INSERT INTO agency_evento_item (company_id, evento_id, descricao, categoria, fornecedor, quantidade, valor_unitario, status, observacao, ordem)
    VALUES (v_comp, p_evento_id, v_desc, v_cat, v_forn, v_qtd, v_vu, v_status, v_obs, v_ordem)
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_comp, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_item', v_id, 'evento_item_criar', NULL, p_dados);
    RETURN jsonb_build_object('ok',true,'id',v_id);
  ELSE
    SELECT * INTO v_ant FROM agency_evento_item WHERE id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','item não encontrado'); END IF;
    IF v_ant.evento_id <> p_evento_id OR NOT (v_ant.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
    IF v_ant.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'erro','item excluído'); END IF;
    UPDATE agency_evento_item
       SET descricao=v_desc, categoria=v_cat, fornecedor=v_forn, quantidade=v_qtd, valor_unitario=v_vu,
           status=v_status, observacao=v_obs, ordem=v_ordem, atualizado_em=now()
     WHERE id = p_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_ant.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_item', p_id, 'evento_item_editar',
            jsonb_build_object('descricao',v_ant.descricao,'quantidade',v_ant.quantidade,'valor_unitario',v_ant.valor_unitario,'status',v_ant.status), p_dados);
    RETURN jsonb_build_object('ok',true,'id',p_id);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_evento_item_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_i agency_evento_item%ROWTYPE;
BEGIN
  SELECT * INTO v_i FROM agency_evento_item WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','item não encontrado'); END IF;
  IF NOT (v_i.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_i.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'ja_excluido',true); END IF;
  UPDATE agency_evento_item SET excluido_em=now(), excluido_por=v_uid, excluido_motivo=nullif(btrim(p_motivo),''), atualizado_em=now() WHERE id=p_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_i.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_item', p_id, 'evento_item_excluir',
          jsonb_build_object('descricao',v_i.descricao,'valor_total',v_i.valor_total), jsonb_build_object('excluido_em',now(),'motivo',nullif(btrim(p_motivo),'')));
  RETURN jsonb_build_object('ok',true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_evento_checklist_salvar(p_evento_id uuid, p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_comp uuid; v_id uuid; v_ant agency_evento_checklist%ROWTYPE;
  v_desc text := nullif(btrim(p_dados->>'descricao'),'');
  v_prazo date := CASE WHEN p_dados->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p_dados->>'prazo')::date END;
  v_ordem int := COALESCE(nullif(p_dados->>'ordem','')::int, 0);
  v_concl boolean := COALESCE((p_dados->>'concluido')::boolean, false);
BEGIN
  SELECT company_id INTO v_comp FROM agency_eventos WHERE id = p_evento_id AND excluido_em IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','evento não encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_desc IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','a tarefa precisa de uma descrição'); END IF;

  IF p_id IS NULL THEN
    INSERT INTO agency_evento_checklist (company_id, evento_id, descricao, prazo, ordem, concluido, concluido_em, concluido_por)
    VALUES (v_comp, p_evento_id, v_desc, v_prazo, v_ordem, v_concl, CASE WHEN v_concl THEN now() END, CASE WHEN v_concl THEN v_uid END)
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_comp, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_checklist', v_id, 'evento_checklist_criar', NULL, p_dados);
    RETURN jsonb_build_object('ok',true,'id',v_id);
  ELSE
    SELECT * INTO v_ant FROM agency_evento_checklist WHERE id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','tarefa não encontrada'); END IF;
    IF v_ant.evento_id <> p_evento_id OR NOT (v_ant.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
    IF v_ant.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'erro','tarefa excluída'); END IF;
    UPDATE agency_evento_checklist
       SET descricao=v_desc, prazo=v_prazo, ordem=v_ordem,
           concluido=v_concl,
           concluido_em = CASE WHEN v_concl AND NOT v_ant.concluido THEN now() WHEN NOT v_concl THEN NULL ELSE v_ant.concluido_em END,
           concluido_por = CASE WHEN v_concl AND NOT v_ant.concluido THEN v_uid WHEN NOT v_concl THEN NULL ELSE v_ant.concluido_por END,
           atualizado_em=now()
     WHERE id = p_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_ant.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_checklist', p_id, 'evento_checklist_editar',
            jsonb_build_object('descricao',v_ant.descricao,'concluido',v_ant.concluido), p_dados);
    RETURN jsonb_build_object('ok',true,'id',p_id);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_evento_checklist_toggle(p_id uuid, p_concluido boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_c agency_evento_checklist%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM agency_evento_checklist WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','tarefa não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_c.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'erro','tarefa excluída'); END IF;
  UPDATE agency_evento_checklist
     SET concluido = COALESCE(p_concluido,false),
         concluido_em = CASE WHEN COALESCE(p_concluido,false) THEN now() END,
         concluido_por = CASE WHEN COALESCE(p_concluido,false) THEN v_uid END,
         atualizado_em = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok',true,'concluido',COALESCE(p_concluido,false));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_evento_checklist_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_c agency_evento_checklist%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM agency_evento_checklist WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','tarefa não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_c.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'ja_excluido',true); END IF;
  UPDATE agency_evento_checklist SET excluido_em=now(), excluido_por=v_uid, excluido_motivo=nullif(btrim(p_motivo),''), atualizado_em=now() WHERE id=p_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_c.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_checklist', p_id, 'evento_checklist_excluir',
          jsonb_build_object('descricao',v_c.descricao,'concluido',v_c.concluido), jsonb_build_object('excluido_em',now(),'motivo',nullif(btrim(p_motivo),'')));
  RETURN jsonb_build_object('ok',true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_evento_item_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_item_excluir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_checklist_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_checklist_toggle(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_checklist_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_item_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_item_excluir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_checklist_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_checklist_toggle(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_checklist_excluir(uuid, text) TO authenticated, service_role;

-- ============================================================= 3) Ajuda (RD-95)
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.eventos.acao_detalhe', '/dashboard/pm/eventos', 'Eventos · Ações', 'Itens e checklist', 'Abre o painel do evento com os itens/fornecedores e o checklist de preparação.', 'Planejar o que o evento precisa e acompanhar o que já está pronto.', 'Itens e checklist → lançar locação, equipe, alimentação.', '—', 'pm', 21, 1, 'publicado'),
 ('pm.eventos.item_total', '/dashboard/pm/eventos', 'Eventos · Itens', 'Itens somam', 'Soma do valor de todos os itens ativos do evento (quantidade × valor unitário).', 'Comparar o que foi planejado em itens com o orçamento previsto do evento.', 'Itens R$ 6.200 de R$ 8.500 previstos.', 'Confundir com o realizado do financeiro: aqui é o planejado por item.', 'pm', 22, 1, 'publicado'),
 ('pm.eventos.item_descricao', '/dashboard/pm/eventos', 'Eventos · Itens', 'Descrição', 'O que é o item (locação de estúdio, diária de cinegrafista, buffet…).', 'Detalhar o que compõe o evento.', 'Diária de câmera + operador.', 'Descrição vazia não é aceita.', 'pm', 23, 1, 'publicado'),
 ('pm.eventos.item_categoria', '/dashboard/pm/eventos', 'Eventos · Itens', 'Categoria', 'Grupo do item (locação, equipe, alimentação, transporte…).', 'Organizar e analisar os custos por tipo.', 'Equipe.', '—', 'pm', 24, 1, 'publicado'),
 ('pm.eventos.item_fornecedor', '/dashboard/pm/eventos', 'Eventos · Itens', 'Fornecedor', 'Quem fornece o item (nome livre). O cadastro formal de fornecedor fica no financeiro da empresa.', 'Saber com quem falar e negociar.', 'Estúdio Luz & Cor.', '—', 'pm', 25, 1, 'publicado'),
 ('pm.eventos.item_quantidade', '/dashboard/pm/eventos', 'Eventos · Itens', 'Qtd.', 'Quantidade do item.', 'Calcular o total (quantidade × valor unitário).', '2 diárias.', 'Quantidade negativa não é aceita.', 'pm', 26, 1, 'publicado'),
 ('pm.eventos.item_valor_unitario', '/dashboard/pm/eventos', 'Eventos · Itens', 'Valor unit. (R$)', 'Preço de uma unidade do item.', 'Compor o custo planejado do evento.', 'R$ 900,00 a diária.', 'Valor negativo não é aceito.', 'pm', 27, 1, 'publicado'),
 ('pm.eventos.item_valor_total', '/dashboard/pm/eventos', 'Eventos · Itens', 'Total', 'Total do item: quantidade × valor unitário (calculado automaticamente).', 'Ver o peso de cada item no orçamento.', '2 × R$ 900 = R$ 1.800,00.', '—', 'pm', 28, 1, 'publicado'),
 ('pm.eventos.item_status', '/dashboard/pm/eventos', 'Eventos · Itens', 'Situação', 'A contratar, contratado, entregue ou cancelado.', 'Acompanhar o que já está fechado e o que falta.', 'Contratado.', '—', 'pm', 29, 1, 'publicado'),
 ('pm.eventos.item_acao', '/dashboard/pm/eventos', 'Eventos · Itens', 'Ações do item', 'Editar ou excluir o item (exclusão rastreável: guarda quem/quando/motivo).', 'Manter a lista de itens correta sem perder histórico.', 'Editar o valor; excluir um item duplicado com motivo.', 'Esperar apagar de vez: é exclusão auditável.', 'pm', 30, 1, 'publicado'),
 ('pm.eventos.item_novo', '/dashboard/pm/eventos', 'Eventos · Itens', 'Adicionar item', 'Lança um novo item/fornecedor do evento.', 'Montar o orçamento do evento item a item.', 'Adicionar item → “Locação de estúdio”.', '—', 'pm', 31, 1, 'publicado'),
 ('pm.eventos.chk_tarefa', '/dashboard/pm/eventos', 'Eventos · Checklist', 'Tarefa', 'O que precisa ser feito para o evento acontecer.', 'Não esquecer nenhum preparativo.', 'Confirmar equipe; enviar roteiro ao cliente.', 'Descrição vazia não é aceita.', 'pm', 32, 1, 'publicado'),
 ('pm.eventos.chk_prazo', '/dashboard/pm/eventos', 'Eventos · Checklist', 'Prazo', 'Até quando a tarefa deve estar pronta (opcional).', 'Organizar a preparação no tempo.', '2 dias antes do evento.', '—', 'pm', 33, 1, 'publicado'),
 ('pm.eventos.chk_concluido', '/dashboard/pm/eventos', 'Eventos · Checklist', 'Concluído', 'Marque quando a tarefa estiver pronta (guarda quem concluiu e quando).', 'Acompanhar o andamento da preparação.', 'Roteiro aprovado → marcar como concluído.', '—', 'pm', 34, 1, 'publicado'),
 ('pm.eventos.chk_novo', '/dashboard/pm/eventos', 'Eventos · Checklist', 'Adicionar tarefa', 'Inclui uma nova tarefa no checklist do evento.', 'Montar o roteiro de preparação.', 'Adicionar tarefa → “Reservar transporte”.', '—', 'pm', 35, 1, 'publicado'),
 ('pm.eventos.chk_acao', '/dashboard/pm/eventos', 'Eventos · Checklist', 'Ações da tarefa', 'Editar o texto/prazo ou excluir a tarefa (exclusão rastreável).', 'Manter o checklist em dia.', 'Editar o prazo; excluir uma tarefa repetida.', '—', 'pm', 36, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ============================================================= 4) Semente DEMO (idempotente) — para o painel não nascer vazio (RD-98 p1)
DO $$
DECLARE v_comp uuid; v_ev uuid;
BEGIN
  SELECT c.id INTO v_comp FROM companies c
   WHERE c.is_demo = true AND EXISTS (SELECT 1 FROM agency_jobs j WHERE j.company_id = c.id)
   ORDER BY c.id LIMIT 1;
  IF v_comp IS NULL THEN RETURN; END IF;
  SELECT id INTO v_ev FROM agency_eventos
   WHERE company_id = v_comp AND excluido_em IS NULL AND nome = 'Gravação institucional — Verão' LIMIT 1;
  IF v_ev IS NULL THEN
    SELECT id INTO v_ev FROM agency_eventos WHERE company_id = v_comp AND excluido_em IS NULL ORDER BY data_inicio DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_ev IS NULL THEN RETURN; END IF;

  INSERT INTO agency_evento_item (company_id, evento_id, descricao, categoria, fornecedor, quantidade, valor_unitario, status, ordem)
  SELECT v_comp, v_ev, d.descricao, d.categoria, d.fornecedor, d.qtd, d.vu, d.status, d.ordem
  FROM (VALUES
    ('Locação de estúdio (diária)', 'locação', 'Estúdio Luz & Cor', 2::numeric, 1200::numeric, 'contratado', 1),
    ('Equipe de filmagem (câmera + operador)', 'equipe', 'Coletivo Audiovisual', 2::numeric, 900::numeric, 'a_contratar', 2),
    ('Alimentação da equipe', 'alimentação', 'Buffet do Chef', 12::numeric, 45::numeric, 'a_contratar', 3)
  ) AS d(descricao, categoria, fornecedor, qtd, vu, status, ordem)
  WHERE NOT EXISTS (SELECT 1 FROM agency_evento_item i WHERE i.evento_id = v_ev AND i.descricao = d.descricao);

  INSERT INTO agency_evento_checklist (company_id, evento_id, descricao, prazo, ordem, concluido, concluido_em)
  SELECT v_comp, v_ev, d.descricao, d.prazo, d.ordem, d.concl, CASE WHEN d.concl THEN now() END
  FROM (VALUES
    ('Confirmar roteiro com o cliente', (current_date + 3), 1, true),
    ('Reservar equipamento de iluminação', (current_date + 4), 2, false),
    ('Enviar ordem de produção à equipe', (current_date + 5), 3, false)
  ) AS d(descricao, prazo, ordem, concl)
  WHERE NOT EXISTS (SELECT 1 FROM agency_evento_checklist ck WHERE ck.evento_id = v_ev AND ck.descricao = d.descricao);
END $$;

-- ============================================================= 5) Origem do dado (RD-98 pilar 3)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_eventos','agency_evento_item','agency_evento_checklist','erp_clientes']::text[],
       rpcs_chamadas = ARRAY['fn_pm_evento_salvar','fn_pm_evento_excluir','fn_pm_evento_item_salvar','fn_pm_evento_item_excluir','fn_pm_evento_checklist_salvar','fn_pm_evento_checklist_toggle','fn_pm_evento_checklist_excluir','fn_usuarios_da_empresa']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/eventos';
