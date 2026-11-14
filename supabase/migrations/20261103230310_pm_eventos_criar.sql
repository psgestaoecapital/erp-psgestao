-- P&M · Eventos & Produções (CEO 31/10) — CONSTRUIR a tela (hoje placeholder, nota 25).
-- Passos 1 + 2 + 5 do plano do CEO numa PR coerente (fecha a tela: tabela + CRUD + "?" + seed + origem).
-- Itens/fornecedores (passo 3) e previsto×realizado do financeiro da GE (passo 4) ficam para PRs seguintes.
-- Tudo ADITIVO e multi-tenant (RD-45). Nada hardcoded da PDOIS. Zero API paga.

-- 1) Tabela nova
CREATE TABLE IF NOT EXISTS public.agency_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  contrato_id uuid,
  job_id uuid,
  nome text NOT NULL,
  tipo text,
  data_inicio date,
  data_fim date,
  local text,
  status text NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado','confirmado','realizado','cancelado')),
  orcamento_previsto numeric,
  responsavel_id uuid,
  observacoes text,
  lancamento_id uuid,              -- elo futuro com erp_pagar (realizado, passo 4) — ainda não usado
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz,
  excluido_em timestamptz,         -- exclusão rastreável (RD-98 p4; nunca DELETE físico)
  excluido_por uuid,
  excluido_motivo text
);
CREATE INDEX IF NOT EXISTS idx_agency_eventos_empresa ON public.agency_eventos (company_id, data_inicio DESC);

ALTER TABLE public.agency_eventos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_eventos'::regclass AND polname='agency_eventos_sel') THEN
    CREATE POLICY agency_eventos_sel ON public.agency_eventos
      FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
-- escrita só pelas RPCs (SECURITY DEFINER); leitura por empresa. Sem anon.
REVOKE ALL ON public.agency_eventos FROM PUBLIC, anon;
GRANT SELECT ON public.agency_eventos TO authenticated;

-- 2) RPCs de CRUD (guarda de empresa idêntica ao padrão vivo; audit_log_global; REVOKE anon)
CREATE OR REPLACE FUNCTION public.fn_pm_evento_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_id uuid; v_ant agency_eventos%ROWTYPE;
  v_nome text := nullif(btrim(p_dados->>'nome'),'');
  v_status text := COALESCE(nullif(btrim(p_dados->>'status'),''),'planejado');
  v_cli uuid := nullif(p_dados->>'cliente_id','')::uuid;
  v_resp uuid := nullif(p_dados->>'responsavel_id','')::uuid;
  v_ini date := CASE WHEN p_dados->>'data_inicio' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p_dados->>'data_inicio')::date END;
  v_fim date := CASE WHEN p_dados->>'data_fim' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p_dados->>'data_fim')::date END;
  v_orc numeric := nullif(p_dados->>'orcamento_previsto','')::numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','o nome do evento é obrigatório'); END IF;
  IF v_status NOT IN ('planejado','confirmado','realizado','cancelado') THEN RETURN jsonb_build_object('ok',false,'erro','status inválido'); END IF;
  IF v_fim IS NOT NULL AND v_ini IS NOT NULL AND v_fim < v_ini THEN RETURN jsonb_build_object('ok',false,'erro','a data de término é anterior à de início'); END IF;
  IF COALESCE(v_orc,0) < 0 THEN RETURN jsonb_build_object('ok',false,'erro','orçamento não pode ser negativo'); END IF;
  IF v_cli IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok',false,'erro','cliente de outra empresa'); END IF;

  IF p_id IS NULL THEN
    INSERT INTO agency_eventos (company_id, cliente_id, nome, tipo, data_inicio, data_fim, local, status, orcamento_previsto, responsavel_id, observacoes)
    VALUES (p_company_id, v_cli, v_nome, nullif(btrim(p_dados->>'tipo'),''), v_ini, v_fim, nullif(btrim(p_dados->>'local'),''), v_status, v_orc, v_resp, nullif(btrim(p_dados->>'observacoes'),''))
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_eventos', v_id, 'evento_criar', NULL, p_dados);
    RETURN jsonb_build_object('ok',true,'id',v_id);
  ELSE
    SELECT * INTO v_ant FROM agency_eventos WHERE id = p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','evento não encontrado'); END IF;
    IF NOT (v_ant.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
    IF v_ant.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'erro','evento excluído'); END IF;
    UPDATE agency_eventos
       SET cliente_id=v_cli, nome=v_nome, tipo=nullif(btrim(p_dados->>'tipo'),''), data_inicio=v_ini, data_fim=v_fim,
           local=nullif(btrim(p_dados->>'local'),''), status=v_status, orcamento_previsto=v_orc, responsavel_id=v_resp,
           observacoes=nullif(btrim(p_dados->>'observacoes'),''), atualizado_em=now()
     WHERE id = p_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_ant.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_eventos', p_id, 'evento_editar',
            jsonb_build_object('nome',v_ant.nome,'status',v_ant.status,'orcamento_previsto',v_ant.orcamento_previsto), p_dados);
    RETURN jsonb_build_object('ok',true,'id',p_id);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_evento_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_e agency_eventos%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM agency_eventos WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','evento não encontrado'); END IF;
  IF NOT (v_e.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  IF v_e.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'ja_excluido',true); END IF;
  UPDATE agency_eventos SET excluido_em=now(), excluido_por=v_uid, excluido_motivo=nullif(btrim(p_motivo),''), atualizado_em=now() WHERE id=p_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_e.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_eventos', p_id, 'evento_excluir',
          jsonb_build_object('nome',v_e.nome,'status',v_e.status), jsonb_build_object('excluido_em',now(),'motivo',nullif(btrim(p_motivo),'')));
  RETURN jsonb_build_object('ok',true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_evento_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_excluir(uuid, text) TO authenticated, service_role;

-- 3) Ajuda (RD-95)
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.eventos.tela', '/dashboard/pm/eventos', 'Eventos', 'Eventos & Produções',
  'Cadastre e acompanhe os eventos/produções da agência: data, local, cliente, status e orçamento previsto.',
  'Organizar a agenda de produções e o orçamento de cada evento num só lugar.',
  'Gravação externa da campanha de verão, 12–13/02, estúdio X.',
  'Usar para job de social comum: aqui é evento/produção, não a pauta diária.',
  'pm', 1, 1, 'publicado'),
 ('pm.eventos.kpi_total', '/dashboard/pm/eventos', 'Eventos · Indicadores', 'Eventos', 'Total de eventos ativos (não excluídos) no filtro atual.', 'Dimensão do que está agendado/realizado.', '7 eventos.', 'Esquecer que respeita os filtros.', 'pm', 2, 1, 'publicado'),
 ('pm.eventos.kpi_proximos', '/dashboard/pm/eventos', 'Eventos · Indicadores', 'Próximos', 'Eventos planejados/confirmados com início a partir de hoje.', 'Ver o que vem pela frente.', '3 próximos.', 'Contar os já realizados: próximos é só o que ainda vai acontecer.', 'pm', 3, 1, 'publicado'),
 ('pm.eventos.kpi_orcamento', '/dashboard/pm/eventos', 'Eventos · Indicadores', 'Orçamento previsto', 'Soma do orçamento previsto dos eventos do filtro.', 'Ter a dimensão financeira do que está planejado.', 'R$ 42.000,00.', 'Confundir com realizado: aqui é previsto (planejado).', 'pm', 4, 1, 'publicado'),
 ('pm.eventos.filtro_cliente', '/dashboard/pm/eventos', 'Eventos · Filtros', 'Cliente', 'Filtra os eventos por cliente.', 'Focar na agenda de um cliente.', 'Cliente Acme.', '—', 'pm', 5, 1, 'publicado'),
 ('pm.eventos.filtro_status', '/dashboard/pm/eventos', 'Eventos · Filtros', 'Status', 'Filtra por situação (planejado/confirmado/realizado/cancelado).', 'Ver só o que interessa agora.', 'Confirmado.', '—', 'pm', 6, 1, 'publicado'),
 ('pm.eventos.acao_novo', '/dashboard/pm/eventos', 'Eventos · Ações', 'Novo evento', 'Abre o formulário para cadastrar um evento.', 'Registrar uma nova produção.', 'Novo evento → preenche nome, datas, cliente.', 'Deixar o nome vazio: é obrigatório.', 'pm', 7, 1, 'publicado'),
 ('pm.eventos.acao_editar', '/dashboard/pm/eventos', 'Eventos · Ações', 'Editar', 'Edita os dados do evento.', 'Corrigir ou atualizar datas, status, orçamento.', 'Mudou a data → Editar.', '—', 'pm', 8, 1, 'publicado'),
 ('pm.eventos.acao_excluir', '/dashboard/pm/eventos', 'Eventos · Ações', 'Excluir', 'Exclui o evento de forma rastreável (guarda quem/quando/motivo; não some do banco).', 'Remover um evento indevido sem perder o histórico.', 'Evento cancelado por engano → Excluir com motivo.', 'Esperar apagar de vez: é exclusão rastreável (auditável).', 'pm', 9, 1, 'publicado'),
 ('pm.eventos.campo_nome', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Nome', 'Nome do evento/produção.', 'Identificar o evento nas listas.', 'Gravação institucional Q1.', 'Nome genérico demais dificulta achar depois.', 'pm', 10, 1, 'publicado'),
 ('pm.eventos.campo_cliente', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Cliente', 'Cliente ligado ao evento (do cadastro da empresa).', 'Ligar o evento ao cliente para relatórios.', 'Acme.', 'Escolher cliente de outra empresa: o sistema recusa.', 'pm', 11, 1, 'publicado'),
 ('pm.eventos.campo_tipo', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Tipo', 'Tipo do evento (gravação, ativação, lançamento…).', 'Classificar para filtrar e analisar.', 'Gravação externa.', '—', 'pm', 12, 1, 'publicado'),
 ('pm.eventos.campo_data_inicio', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Início', 'Data de início do evento.', 'Agenda e KPI de próximos.', '12/02/2026.', '—', 'pm', 13, 1, 'publicado'),
 ('pm.eventos.campo_data_fim', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Término', 'Data de término (se durar mais de um dia).', 'Delimitar a janela do evento.', '13/02/2026.', 'Término antes do início: o sistema recusa.', 'pm', 14, 1, 'publicado'),
 ('pm.eventos.campo_local', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Local', 'Onde o evento acontece.', 'Logística da produção.', 'Estúdio X, São Paulo.', '—', 'pm', 15, 1, 'publicado'),
 ('pm.eventos.campo_status', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Status', 'Situação: planejado, confirmado, realizado ou cancelado.', 'Acompanhar o andamento.', 'Confirmado.', '—', 'pm', 16, 1, 'publicado'),
 ('pm.eventos.campo_orcamento', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Orçamento previsto (R$)', 'Quanto se espera gastar com o evento.', 'Planejar o custo; o realizado virá do financeiro (em breve).', 'R$ 8.000,00.', 'Valor negativo: não é aceito.', 'pm', 17, 1, 'publicado'),
 ('pm.eventos.campo_responsavel', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Responsável', 'Quem conduz o evento na agência.', 'Saber a quem recorrer.', 'João (produção).', '—', 'pm', 18, 1, 'publicado'),
 ('pm.eventos.campo_observacoes', '/dashboard/pm/eventos', 'Eventos · Formulário', 'Observações', 'Notas livres sobre o evento.', 'Registrar detalhes que não cabem nos campos.', 'Levar 2 câmeras; cliente pediu making-of.', '—', 'pm', 19, 1, 'publicado'),
 ('pm.eventos.col_acoes', '/dashboard/pm/eventos', 'Eventos · Colunas', 'Ações', 'Editar ou excluir o evento da linha.', 'Agir sem sair da lista.', 'Editar/Excluir.', '—', 'pm', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 4) Semente DEMO (idempotente, só empresa is_demo que tenha carteira P&M) — para a tela não nascer morta (RD-98 p1)
DO $$
DECLARE v_comp uuid; v_cli uuid;
BEGIN
  SELECT c.id INTO v_comp FROM companies c
   WHERE c.is_demo = true AND EXISTS (SELECT 1 FROM agency_jobs j WHERE j.company_id = c.id)
   ORDER BY c.id LIMIT 1;
  IF v_comp IS NULL THEN RETURN; END IF;
  SELECT id INTO v_cli FROM erp_clientes WHERE company_id = v_comp AND ativo IS NOT FALSE ORDER BY created_at NULLS LAST LIMIT 1;

  INSERT INTO agency_eventos (company_id, cliente_id, nome, tipo, data_inicio, data_fim, local, status, orcamento_previsto, observacoes)
  SELECT v_comp, v_cli, d.nome, d.tipo, d.ini, d.fim, d.local, d.status, d.orc, d.obs
  FROM (VALUES
    ('Gravação institucional — Verão', 'gravação', (current_date + 7), (current_date + 8), 'Estúdio Central', 'confirmado', 8500::numeric, 'Dois dias de set; equipe de 6.'),
    ('Ativação de marca no shopping', 'ativação', (current_date + 21), (current_date + 21), 'Shopping Pátio', 'planejado', 15000::numeric, 'Stand + brindes + influenciadores locais.'),
    ('Lançamento de produto', 'lançamento', (current_date - 20), (current_date - 20), 'Rooftop Hotel', 'realizado', 22000::numeric, 'Cobertura de redes ao vivo.')
  ) AS d(nome, tipo, ini, fim, local, status, orc, obs)
  WHERE NOT EXISTS (SELECT 1 FROM agency_eventos e WHERE e.company_id = v_comp AND e.nome = d.nome);
END $$;

-- 5) Origem do dado (RD-98 pilar 3)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_eventos','erp_clientes']::text[],
       rpcs_chamadas = ARRAY['fn_pm_evento_salvar','fn_pm_evento_excluir','fn_usuarios_da_empresa']::text[],
       estado_real = 'pronto',
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/eventos';
