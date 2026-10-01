-- Pdois #97 + #98 (proposta aprovada pelo CEO em 01/10): TAREFAS no lead/cliente, no lugar do registro de reunião.
--  · tipos: ligar, WhatsApp, reunião, agendar visita, e-mail, outro · data/hora · responsável · situação (a fazer / feita /
--    cancelada) · resultado;
--  · atribuir: o responsável recebe aviso no sino (#120 · erp_notificacao_usuario) e a tarefa entra na agenda dele (#119 ·
--    erp_agendamento comercial com responsavel_id) e em "Minhas tarefas";
--  · reuniões já registradas viram tarefa do tipo "reunião" SEM PERDER NADA: o evento da agenda continua onde está e a
--    tarefa aponta para ele (agendamento_id). A conversão tem PRÉVIA (p_aplicar = false) e só grava com p_aplicar = true.
-- Grava só pelas funções (guarda da empresa: fn__guarda_empresa · autoria da sessão). Nada é apagado (RD-30).

CREATE TABLE IF NOT EXISTS public.agency_lead_tarefa (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id          uuid REFERENCES public.agency_leads(id) ON DELETE SET NULL,
  cliente_id       uuid REFERENCES public.agency_clientes(id) ON DELETE SET NULL,
  tipo             text NOT NULL CHECK (tipo IN ('ligar', 'whatsapp', 'reuniao', 'visita', 'email', 'outro')),
  titulo           text NOT NULL CHECK (length(btrim(titulo)) > 0),
  data             date NOT NULL,
  hora             time,
  responsavel_id   uuid,
  responsavel_nome text,
  situacao         text NOT NULL DEFAULT 'a_fazer' CHECK (situacao IN ('a_fazer', 'feita', 'cancelada')),
  resultado        text,
  agendamento_id   uuid REFERENCES public.erp_agendamento(id) ON DELETE SET NULL,
  origem           text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'reuniao_convertida')),
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  concluida_em     timestamptz,
  CONSTRAINT agency_lead_tarefa_alvo CHECK (lead_id IS NOT NULL OR cliente_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS agency_lead_tarefa_agendamento_uq ON public.agency_lead_tarefa (agendamento_id) WHERE agendamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agency_lead_tarefa_resp_idx ON public.agency_lead_tarefa (company_id, responsavel_id, situacao, data);
CREATE INDEX IF NOT EXISTS agency_lead_tarefa_lead_idx ON public.agency_lead_tarefa (lead_id);

ALTER TABLE public.agency_lead_tarefa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_lead_tarefa_ler ON public.agency_lead_tarefa;
CREATE POLICY agency_lead_tarefa_ler ON public.agency_lead_tarefa
  FOR SELECT TO authenticated USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.agency_lead_tarefa FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agency_lead_tarefa TO authenticated;

-- rótulo humano do tipo (aviso, agenda)
CREATE OR REPLACE FUNCTION public.fn_lead_tarefa_tipo_rotulo(p_tipo text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE p_tipo WHEN 'ligar' THEN 'Ligar' WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'reuniao' THEN 'Reunião'
    WHEN 'visita' THEN 'Visita' WHEN 'email' THEN 'E-mail' ELSE 'Tarefa' END
$function$;
GRANT EXECUTE ON FUNCTION public.fn_lead_tarefa_tipo_rotulo(text) TO authenticated, service_role;

-- ── salvar (criar ou alterar) ────────────────────────────────────────────────────────────────────────────────────
-- p_dados: tipo, titulo, data (YYYY-MM-DD), hora (HH:MM, opcional), responsavel_id (opcional), lead_id | cliente_id.
CREATE OR REPLACE FUNCTION public.fn_lead_tarefa_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ant public.agency_lead_tarefa%ROWTYPE;
  v_id uuid; v_tipo text; v_titulo text; v_data date; v_hora time; v_resp uuid; v_resp_nome text;
  v_lead uuid; v_cli uuid; v_nome_alvo text; v_ag uuid; v_rot text; v_autor uuid := auth.uid(); v_autor_nome text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_tipo   := lower(btrim(COALESCE(p_dados->>'tipo', '')));
  v_titulo := btrim(COALESCE(p_dados->>'titulo', ''));
  IF v_tipo NOT IN ('ligar', 'whatsapp', 'reuniao', 'visita', 'email', 'outro') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido', 'mensagem', 'Escolha o tipo da tarefa.');
  END IF;
  IF v_titulo = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_titulo', 'mensagem', 'Escreva o que precisa ser feito.');
  END IF;
  BEGIN
    v_data := (p_dados->>'data')::date;
    v_hora := NULLIF(btrim(COALESCE(p_dados->>'hora', '')), '')::time;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'data_invalida', 'mensagem', 'Data ou hora inválida.');
  END;
  IF v_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_data', 'mensagem', 'Informe a data da tarefa.');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_ant FROM public.agency_lead_tarefa WHERE id = p_id AND company_id = p_company_id;
    IF v_ant.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
    v_lead := v_ant.lead_id; v_cli := v_ant.cliente_id;
  ELSE
    v_lead := NULLIF(p_dados->>'lead_id', '')::uuid;
    v_cli  := NULLIF(p_dados->>'cliente_id', '')::uuid;
  END IF;
  -- alvo tem de ser da mesma empresa
  IF v_lead IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(empresa), ''), nome) INTO v_nome_alvo FROM public.agency_leads
     WHERE id = v_lead AND company_id = p_company_id AND deleted_at IS NULL;
    IF v_nome_alvo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead_invalido', 'mensagem', 'Lead não encontrado nesta empresa.'); END IF;
  ELSIF v_cli IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(nome_fantasia), ''), nome) INTO v_nome_alvo FROM public.agency_clientes
     WHERE id = v_cli AND company_id = p_company_id;
    IF v_nome_alvo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_invalido', 'mensagem', 'Cliente não encontrado nesta empresa.'); END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_alvo', 'mensagem', 'A tarefa precisa de um lead ou cliente.');
  END IF;

  -- responsável: alguém com acesso à empresa (vínculo ou equipe PS); vazio = quem está criando
  v_resp := COALESCE(NULLIF(p_dados->>'responsavel_id', '')::uuid, v_autor);
  IF v_resp IS NOT NULL THEN
    IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_resp AND uc.company_id = p_company_id)
            OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_resp AND u.system_role IN ('PS_ADMIN', 'PS_ADMIN_CVM'))) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'responsavel_invalido', 'mensagem', 'O responsável não tem acesso a esta empresa.');
    END IF;
    SELECT COALESCE(NULLIF(btrim(full_name), ''), email) INTO v_resp_nome FROM public.users WHERE id = v_resp;
  END IF;
  v_rot := public.fn_lead_tarefa_tipo_rotulo(v_tipo);

  IF p_id IS NULL THEN
    INSERT INTO public.agency_lead_tarefa (company_id, lead_id, cliente_id, tipo, titulo, data, hora, responsavel_id, responsavel_nome, criado_por)
    VALUES (p_company_id, v_lead, v_cli, v_tipo, v_titulo, v_data, v_hora, v_resp, v_resp_nome, v_autor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.agency_lead_tarefa
       SET tipo = v_tipo, titulo = v_titulo, data = v_data, hora = v_hora,
           responsavel_id = v_resp, responsavel_nome = v_resp_nome, atualizado_em = now()
     WHERE id = p_id
    RETURNING id, agendamento_id INTO v_id, v_ag;
  END IF;

  -- agenda do responsável (#119): um evento comercial por tarefa, ligado pelo id
  IF v_ag IS NULL THEN
    INSERT INTO public.erp_agendamento (company_id, origem_modulo, titulo, responsavel_id, responsavel_nome, data, hora_inicio, hora_fim, dados, created_by)
    VALUES (p_company_id, 'comercial', v_rot || ' · ' || v_nome_alvo || ' — ' || v_titulo, v_resp, v_resp_nome, v_data, v_hora,
            CASE WHEN v_hora IS NULL THEN NULL ELSE (v_hora + interval '30 minutes')::time END,
            jsonb_build_object('lead_id', v_lead, 'cliente_id', v_cli, 'tarefa_id', v_id, 'tipo_tarefa', v_tipo), v_autor)
    RETURNING id INTO v_ag;
    UPDATE public.agency_lead_tarefa SET agendamento_id = v_ag WHERE id = v_id;
  ELSE
    UPDATE public.erp_agendamento
       SET titulo = v_rot || ' · ' || v_nome_alvo || ' — ' || v_titulo, responsavel_id = v_resp, responsavel_nome = v_resp_nome,
           data = v_data, hora_inicio = v_hora, hora_fim = CASE WHEN v_hora IS NULL THEN NULL ELSE (v_hora + interval '30 minutes')::time END,
           dados = COALESCE(dados, '{}'::jsonb) || jsonb_build_object('tarefa_id', v_id, 'tipo_tarefa', v_tipo), updated_at = now()
     WHERE id = v_ag AND company_id = p_company_id;
  END IF;

  -- reunião continua marcando o card do lead (📅), como antes
  IF v_tipo = 'reuniao' AND v_lead IS NOT NULL THEN
    UPDATE public.agency_leads
       SET reuniao_agendada_em = (v_data + COALESCE(v_hora, time '09:00')) AT TIME ZONE 'America/Sao_Paulo', atualizado_em = now()
     WHERE id = v_lead AND company_id = p_company_id;
  END IF;

  -- aviso no sino (#120): tarefa nova ou trocada de responsável, nunca para quem atribuiu
  IF v_resp IS NOT NULL AND v_resp IS DISTINCT FROM v_autor
     AND (p_id IS NULL OR v_ant.responsavel_id IS DISTINCT FROM v_resp) THEN
    SELECT COALESCE(NULLIF(btrim(full_name), ''), email) INTO v_autor_nome FROM public.users WHERE id = v_autor;
    INSERT INTO public.erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES (p_company_id, v_resp, 'tarefa_atribuida', v_rot || ' · ' || v_nome_alvo,
            v_titulo || ' — ' || to_char(v_data, 'DD/MM') || COALESCE(' ' || to_char(v_hora, 'HH24:MI'), '') || COALESCE(' · por ' || v_autor_nome, ''),
            '/dashboard/pm/leads?tarefas=minhas', 'agency_lead_tarefa', v_id, v_autor);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'agendamento_id', v_ag);
END $function$;
REVOKE ALL ON FUNCTION public.fn_lead_tarefa_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lead_tarefa_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- ── feita / cancelada / reabrir, com resultado ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_lead_tarefa_situacao(p_id uuid, p_situacao text, p_resultado text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t public.agency_lead_tarefa%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.agency_lead_tarefa WHERE id = p_id;
  IF v_t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_t.company_id);
  IF p_situacao NOT IN ('a_fazer', 'feita', 'cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida');
  END IF;
  UPDATE public.agency_lead_tarefa
     SET situacao = p_situacao,
         resultado = COALESCE(NULLIF(btrim(p_resultado), ''), resultado),
         concluida_em = CASE WHEN p_situacao = 'a_fazer' THEN NULL ELSE now() END,
         atualizado_em = now()
   WHERE id = p_id;
  -- a agenda acompanha (o evento nunca é apagado)
  IF v_t.agendamento_id IS NOT NULL THEN
    UPDATE public.erp_agendamento
       SET status = CASE p_situacao WHEN 'feita' THEN 'concluido' WHEN 'cancelada' THEN 'cancelado' ELSE 'agendado' END,
           updated_at = now()
     WHERE id = v_t.agendamento_id AND company_id = v_t.company_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'situacao', p_situacao);
END $function$;
REVOKE ALL ON FUNCTION public.fn_lead_tarefa_situacao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lead_tarefa_situacao(uuid, text, text) TO authenticated, service_role;

-- ── reuniões já registradas → tarefa "reunião" (prévia; grava só com p_aplicar) ──────────────────────────────────
-- Fonte: eventos comerciais da agenda ligados a lead (dados.lead_id), não excluídos e ainda sem tarefa. O evento NÃO muda
-- (a tarefa aponta para ele). Reunião de data passada entra como "feita" com a anotação de que veio do registro antigo;
-- de hoje em diante, "a fazer". Responsável: o do evento; se não houver, o do lead; se não houver, quem criou o evento
-- (a prévia mostra de onde veio cada um). O nome vem do cadastro do usuário — os eventos antigos da Pdois têm o
-- responsável mas não o nome (defeito corrigido na #1960).
CREATE OR REPLACE FUNCTION public.fn_lead_tarefa_converter_reunioes(p_company_id uuid, p_aplicar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lista jsonb; v_n int := 0; v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  DROP TABLE IF EXISTS _conv_reuniao;
  CREATE TEMP TABLE _conv_reuniao ON COMMIT DROP AS
    SELECT a.id ag_id, l.id lead_id, COALESCE(NULLIF(btrim(l.empresa), ''), l.nome) lead_nome,
           COALESCE(NULLIF(btrim(a.titulo), ''), 'Reunião') titulo, a.data, a.hora_inicio,
           COALESCE(a.responsavel_id, l.responsavel_id, a.created_by) resp_id,
           CASE WHEN a.responsavel_id IS NOT NULL THEN 'evento' WHEN l.responsavel_id IS NOT NULL THEN 'lead'
                WHEN a.created_by IS NOT NULL THEN 'criador_evento' ELSE 'nenhum' END resp_fonte,
           CASE WHEN a.data < v_hoje THEN 'feita' ELSE 'a_fazer' END situacao
      FROM public.erp_agendamento a
      JOIN public.agency_leads l ON l.id = (a.dados->>'lead_id')::uuid AND l.company_id = a.company_id
     WHERE a.company_id = p_company_id AND a.origem_modulo = 'comercial' AND a.excluido_em IS NULL
       AND a.dados ? 'lead_id' AND (a.dados->>'lead_id') ~ '^[0-9a-f-]{36}$'
       AND NOT EXISTS (SELECT 1 FROM public.agency_lead_tarefa t WHERE t.agendamento_id = a.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('agendamento_id', c.ag_id, 'lead', c.lead_nome, 'titulo', c.titulo, 'data', c.data,
           'hora', to_char(c.hora_inicio, 'HH24:MI'), 'responsavel', COALESCE(NULLIF(btrim(u.full_name), ''), u.email),
           'responsavel_veio_de', c.resp_fonte, 'situacao', c.situacao) ORDER BY c.data), '[]'::jsonb), count(*)
    INTO v_lista, v_n FROM _conv_reuniao c LEFT JOIN public.users u ON u.id = c.resp_id;

  IF NOT COALESCE(p_aplicar, false) THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false, 'total', v_n,
      'passadas', (SELECT count(*) FROM _conv_reuniao WHERE situacao = 'feita'),
      'futuras', (SELECT count(*) FROM _conv_reuniao WHERE situacao = 'a_fazer'),
      'responsavel_por_fonte', (SELECT jsonb_object_agg(resp_fonte, n) FROM (SELECT resp_fonte, count(*) n FROM _conv_reuniao GROUP BY 1) f),
      'eventos_que_ganham_responsavel', (SELECT count(*) FROM _conv_reuniao WHERE resp_fonte <> 'evento' AND resp_id IS NOT NULL),
      'itens', v_lista);
  END IF;

  INSERT INTO public.agency_lead_tarefa (company_id, lead_id, tipo, titulo, data, hora, responsavel_id, responsavel_nome,
                                         situacao, resultado, agendamento_id, origem, criado_por, concluida_em)
  SELECT p_company_id, c.lead_id, 'reuniao', c.titulo, c.data, c.hora_inicio, c.resp_id, COALESCE(NULLIF(btrim(u.full_name), ''), u.email),
         c.situacao,
         CASE WHEN c.situacao = 'feita' THEN 'Reunião registrada antes das tarefas (convertida em ' || to_char(v_hoje, 'DD/MM/YYYY') || ').' END,
         c.ag_id, 'reuniao_convertida', auth.uid(),
         CASE WHEN c.situacao = 'feita' THEN now() END
    FROM _conv_reuniao c LEFT JOIN public.users u ON u.id = c.resp_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- o evento sem responsável ganha o mesmo da tarefa (só preenche o vazio; nada é sobrescrito) → aparece em "Minha agenda"
  UPDATE public.erp_agendamento a
     SET responsavel_id = c.resp_id, responsavel_nome = COALESCE(NULLIF(btrim(u.full_name), ''), u.email), updated_at = now()
    FROM _conv_reuniao c LEFT JOIN public.users u ON u.id = c.resp_id
   WHERE a.id = c.ag_id AND a.responsavel_id IS NULL AND c.resp_id IS NOT NULL;
  RETURN jsonb_build_object('ok', true, 'aplicado', true, 'convertidas', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.fn_lead_tarefa_converter_reunioes(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lead_tarefa_converter_reunioes(uuid, boolean) TO authenticated, service_role;
