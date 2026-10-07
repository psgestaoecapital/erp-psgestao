-- CANAL PS · PR A (CEO 07/10 16:20) — a Claude de cada sócio conversa com o Code do PRÓPRIO sócio, sem passar pelo CEO
-- nem pelo Eng. Chefe. Faixa de migration 60. Etiqueta revisao-eng-chefe (permissão + LGPD).
--
-- 1) erp_agente_dono: qual usuário é dono de qual Code e com que remetente ("<socio>-chat") ele fala na caixa.
--    Leitura só da equipe PS (ps_equipe_acesso ativo); escrita só service_role. gilberto-* seguem com o eng_chefe.
-- 2) erp_agente_mensagem: aceita o remetente "<socio>-chat" — SÓ para o Code do próprio dono ativo, só tarefa, com
--    enviado_por = o próprio remetente (gatilho). Para eng_chefe/ceo nada muda (Code de sócio segue só com aviso deles).
-- 3) Acionamento: o corpo do fn_agente_acionar vai para fn__agente_acionar (interno, revogado de todos). O gatilho de
--    INSERT/OK passa a chamar o interno — antes ele chamava a função com a guarda do canal de serviço, que recusaria o
--    pedido feito pelo sócio LOGADO. fn_agente_acionar (chamada direta) continua com a mesma guarda, mesmo corpo.
-- 4) fn_agente_pedido_enviar: o sócio logado pede ao SEU Code (destino nunca é parâmetro); empresa/chamado só da
--    carteira dele (erp_carteira_responsavel vigente — a mesma fonte dos chamados em equipe, RD-65); núcleo = espera o
--    OK do CEO sem acionar; 30 pedidos/hora; registro em audit_log_global.
-- 5) fn_agente_pedidos_meus: o sócio vê os pedidos que mandou (status, PR, resposta do Code) e a própria carteira.

-- ── 1) donos dos Codes ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_agente_dono (
  agente         text PRIMARY KEY REFERENCES public.erp_agente_rotina(agente),
  user_id        uuid NOT NULL REFERENCES public.users(id),
  remetente_chat text UNIQUE CHECK (remetente_chat ~ '^[a-z][a-z0-9]*-chat$'),
  ativo          boolean NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
-- um Code ativo por pessoa: "o agente dele" nunca é ambíguo
CREATE UNIQUE INDEX IF NOT EXISTS ux_agente_dono_um_ativo_por_usuario ON public.erp_agente_dono (user_id) WHERE ativo;
COMMENT ON TABLE public.erp_agente_dono IS
  'Canal PS: dono de cada Code de sócio e o remetente (<socio>-chat) com que a Claude dele fala na caixa. Só ativo envia. gilberto-* ficam com o eng_chefe.';

ALTER TABLE public.erp_agente_dono ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_agente_dono FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_agente_dono TO authenticated;
GRANT ALL ON TABLE public.erp_agente_dono TO service_role;
-- ps_equipe_acesso tem RLS própria (só PS_ADMIN lê): a policy consulta por função SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.fn_equipe_ps_ativa() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM ps_equipe_acesso e WHERE e.user_id = auth.uid() AND e.ativo)
$function$;
REVOKE ALL ON FUNCTION public.fn_equipe_ps_ativa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_equipe_ps_ativa() TO authenticated, service_role;
DROP POLICY IF EXISTS erp_agente_dono_sel_equipe_ps ON public.erp_agente_dono;
CREATE POLICY erp_agente_dono_sel_equipe_ps ON public.erp_agente_dono FOR SELECT TO authenticated
  USING (public.fn_equipe_ps_ativa());

-- carga (só onde o usuário e a rotina existem — no banco de testes pode faltar algum)
INSERT INTO public.erp_agente_dono (agente, user_id, remetente_chat, ativo)
SELECT v.agente, v.user_id, v.remetente, v.ativo
  FROM (VALUES
    ('jordana-code',  '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, 'jordana-chat',  true),
    ('rodrigo-code',  '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, 'rodrigo-chat',  true),
    ('andre-code',    'f3867e65-94d6-43c0-aeb9-8da82fcfe433'::uuid, 'andre-chat',    false),
    ('stephany-code', 'ef06f426-c001-41dc-bd56-adac0cc08085'::uuid, 'stephany-chat', false)
  ) AS v(agente, user_id, remetente, ativo)
 WHERE EXISTS (SELECT 1 FROM public.users u WHERE u.id = v.user_id)
   AND EXISTS (SELECT 1 FROM public.erp_agente_rotina r WHERE r.agente = v.agente)
ON CONFLICT (agente) DO NOTHING;

-- ── 2) caixa: remetente <socio>-chat (só para o próprio Code) ────────────────────────────────────────────────────
ALTER TABLE public.erp_agente_mensagem ADD COLUMN IF NOT EXISTS empresa_id uuid;
ALTER TABLE public.erp_agente_mensagem ADD COLUMN IF NOT EXISTS chamado_numero integer;
CREATE INDEX IF NOT EXISTS erp_agente_mensagem_de_criado_idx ON public.erp_agente_mensagem (de, criado_em DESC);

ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_de_check;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_de_check
  CHECK (de IN ('eng_chefe','ceo') OR de ~ '^[a-z][a-z0-9]*-chat$');
-- Code de sócio: do eng_chefe/ceo segue SÓ aviso; tarefa só do remetente-chat (o gatilho abaixo amarra ao próprio dono)
ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para IN ('gilberto-desenv','gilberto-produto','gilberto-chamados') OR de ~ '^[a-z][a-z0-9]*-chat$');

CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_remetente_chat() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.de IN ('eng_chefe','ceo') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_dono d WHERE d.remetente_chat = NEW.de AND d.agente = NEW.para AND d.ativo) THEN
    RAISE EXCEPTION 'remetente % só fala com o Code do próprio dono ativo (destino %)', NEW.de, NEW.para USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo <> 'tarefa' OR NEW.enviado_por IS DISTINCT FROM NEW.de THEN
    RAISE EXCEPTION 'pedido do canal PS: tipo tarefa e enviado_por = %', NEW.de USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_remetente_chat() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agente_mensagem_remetente_chat ON public.erp_agente_mensagem;
CREATE TRIGGER trg_agente_mensagem_remetente_chat BEFORE INSERT OR UPDATE OF de, para, tipo, enviado_por ON public.erp_agente_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.fn__agente_mensagem_remetente_chat();

-- ── 3) acionamento: corpo único em fn__agente_acionar ────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn__agente_acionar — interno, revogado de PUBLIC/anon/authenticated; só o gatilho da caixa e a fn_agente_acionar (que passa pela guarda do canal) o chamam
CREATE OR REPLACE FUNCTION public.fn__agente_acionar(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_url text; v_token text; v_req bigint; v_res jsonb;
BEGIN
  SELECT msg.*, r.aciona INTO m
    FROM erp_agente_mensagem msg JOIN erp_agente_rotina r ON r.agente = msg.para
   WHERE msg.id = p_mensagem_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;

  IF m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'aguarda_ok_ceo');
  ELSIF public.fn__agente_lease_ativa(m.para) THEN
    -- sessão trabalhando: não dispara outra e não mexe na mensagem (não adia o despertador)
    RETURN jsonb_build_object('ok', true, 'em', now(), 'acionou', false, 'motivo', 'sessao_ativa');
  ELSIF NOT m.aciona THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'agente_sem_acionamento');
  ELSE
    SELECT decrypted_secret INTO v_url   FROM vault.decrypted_secrets WHERE name = 'agente_rotina_url_'   || m.para;
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'agente_rotina_token_' || m.para;
    IF v_url IS NULL OR v_token IS NULL THEN
      v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'rotina_nao_configurada_no_cofre');
    ELSE
      SELECT net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'Authorization',     'Bearer ' || v_token,
          'anthropic-beta',    'experimental-cc-routine-2026-04-01',
          'anthropic-version', '2023-06-01'),
        body    := jsonb_build_object('text',
          'Nova mensagem ' || m.id::text || ' na caixa de ' || m.para || ' (de ' || m.de || '). '
          || 'Leia pelo canal protegido: SELECT fn_agente_caixa(''' || m.para || ''');'),
        timeout_milliseconds := 15000
      ) INTO v_req;
      v_res := jsonb_build_object('em', now(), 'acionou', true, 'request_id', v_req);
    END IF;
  END IF;

  UPDATE erp_agente_mensagem SET acionamento = v_res, atualizado_em = now() WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true) || v_res;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn__agente_acionar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_agente_acionar(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  RETURN public.fn__agente_acionar(p_mensagem_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_acionar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_trg_acionar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.arquivada THEN PERFORM public.fn__agente_acionar(NEW.id); END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.requer_ok_ceo AND OLD.ok_ceo_em IS NULL AND NEW.ok_ceo_em IS NOT NULL AND NOT NEW.arquivada THEN
      PERFORM public.fn__agente_acionar(NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_trg_acionar() FROM PUBLIC, anon, authenticated;

-- ── 4) carteira (mesma fonte dos chamados em equipe) ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn__carteira_usuario_pode(p_user uuid, p_company_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM erp_carteira_responsavel c
                  WHERE c.company_id = p_company_id AND c.responsavel_id = p_user AND c.vigencia_fim IS NULL)
$function$;
REVOKE ALL ON FUNCTION public.fn__carteira_usuario_pode(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 5) o sócio pede ao SEU Code ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agente_pedido_enviar(p_assunto text, p_corpo text, p_chamado_numero integer DEFAULT NULL,
  p_empresa_id uuid DEFAULT NULL, p_nucleo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  d record; v_ch_numero integer; v_ch_titulo text; v_ch_emp uuid; v_emp uuid; v_emp_nome text; v_n int; v_id uuid; v_ac jsonb; v_corpo text;
  v_assunto text := btrim(coalesce(p_assunto, ''));
  v_texto   text := btrim(coalesce(p_corpo, ''));
  v_nucleo  boolean := coalesce(p_nucleo, false);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio', 'mensagem', 'Entre no ERP com o seu usuário para pedir ao seu Code.');
  END IF;
  -- guarda: só o dono ATIVO de um Code; o destino é SEMPRE o Code dele (nunca vem de parâmetro)
  SELECT * INTO d FROM erp_agente_dono WHERE user_id = v_uid AND ativo AND remetente_chat IS NOT NULL;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM erp_agente_dono WHERE user_id = v_uid) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'code_inativo',
        'mensagem', 'O seu Code ainda não está ativo no Canal PS. Peça ao CEO para ativá-lo; até lá, os pedidos vão pelo Eng. Chefe.');
    END IF;
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_code',
      'mensagem', 'O Canal PS é só para sócio com Code próprio ativo. Seu usuário não é dono de nenhum Code.');
  END IF;
  IF v_assunto = '' OR v_texto = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'assunto_e_texto_obrigatorios', 'mensagem', 'Escreva o assunto e o que o Code deve fazer.');
  END IF;
  IF length(v_assunto) > 200 OR length(v_texto) > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'texto_longo', 'mensagem', 'Assunto até 200 caracteres e texto até 20 mil.');
  END IF;

  -- empresa/chamado: só da CARTEIRA do sócio
  v_emp := p_empresa_id;
  IF p_chamado_numero IS NOT NULL THEN
    SELECT s.numero, s.company_id, s.titulo INTO v_ch_numero, v_ch_emp, v_ch_titulo FROM sugestoes s WHERE s.numero = p_chamado_numero;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'chamado_nao_encontrado', 'mensagem', format('Não achei o chamado #%s. Confira o número na Central de Atendimento.', p_chamado_numero));
    END IF;
    IF p_empresa_id IS NOT NULL AND p_empresa_id IS DISTINCT FROM v_ch_emp THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'empresa_diferente_do_chamado', 'mensagem', 'O chamado é de outra empresa: informe só o chamado (a empresa vem dele).');
    END IF;
    v_emp := v_ch_emp;
    IF v_emp IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'fora_da_carteira', 'mensagem', format('O chamado #%s não tem empresa, então não está na sua carteira. Peça ao CEO ou ao Eng. Chefe.', p_chamado_numero));
    END IF;
  END IF;
  IF v_emp IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social) INTO v_emp_nome FROM companies c WHERE c.id = v_emp;
    IF NOT public.fn__carteira_usuario_pode(v_uid, v_emp) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'fora_da_carteira', 'mensagem', format(
        'A empresa %s não está na sua carteira (Administração › Carteira), então o seu Code não pode trabalhar nela. '
        || 'Peça só para empresas da sua carteira, deixe empresa e chamado em branco para um pedido interno, '
        || 'ou fale com o CEO se essa empresa deveria ser sua.', coalesce(v_emp_nome, 'informada')));
    END IF;
  END IF;

  -- limite: 30 pedidos por hora por sócio (trava por Code para dois pedidos simultâneos não passarem juntos)
  PERFORM pg_advisory_xact_lock(hashtext('agente_pedido:' || d.agente));
  SELECT count(*) INTO v_n FROM erp_agente_mensagem WHERE de = d.remetente_chat AND criado_em > now() - interval '1 hour';
  IF v_n >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'limite_hora', 'mensagem',
      'Você já mandou 30 pedidos ao seu Code na última hora. Junte os próximos num pedido só ou espere um pouco.');
  END IF;

  v_corpo := v_texto || E'\n\n— Pedido de ' || d.remetente_chat || ' pelo Canal PS'
    || CASE WHEN p_chamado_numero IS NOT NULL THEN format(E'\nChamado: #%s — %s', v_ch_numero, coalesce(v_ch_titulo, '')) ELSE '' END
    || CASE WHEN v_emp IS NOT NULL THEN format(E'\nEmpresa (carteira de %s): %s (%s)', d.remetente_chat, coalesce(v_emp_nome, '?'), v_emp) ELSE '' END
    || CASE WHEN v_nucleo THEN E'\nNÚCLEO: só executar depois do OK do CEO (requer_ok_ceo).' ELSE '' END;

  -- o gatilho da caixa aciona a rotina (fn__agente_acionar); com núcleo, fica em aguarda_ok_ceo e NÃO aciona
  INSERT INTO erp_agente_mensagem (para, de, tipo, assunto, corpo, requer_ok_ceo, enviado_por, empresa_id, chamado_numero)
  VALUES (d.agente, d.remetente_chat, 'tarefa', v_assunto, v_corpo, v_nucleo, d.remetente_chat, v_emp, p_chamado_numero)
  RETURNING id INTO v_id;
  SELECT acionamento INTO v_ac FROM erp_agente_mensagem WHERE id = v_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (v_emp, v_uid, (SELECT u.email FROM users u WHERE u.id = v_uid), 'erp_agente_mensagem', v_id::text, 'agente_pedido_enviar',
          jsonb_build_object('agente', d.agente, 'de', d.remetente_chat, 'assunto', v_assunto, 'chamado_numero', p_chamado_numero,
                             'empresa_id', v_emp, 'nucleo', v_nucleo, 'acionamento', v_ac));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'agente', d.agente, 'requer_ok_ceo', v_nucleo, 'acionamento', v_ac,
    'mensagem', CASE WHEN v_nucleo
      THEN format('Pedido de núcleo registrado para o %s: ele só começa depois do OK do CEO.', d.agente)
      ELSE format('Pedido enviado ao %s.', d.agente) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_pedido_enviar(text, text, integer, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_pedido_enviar(text, text, integer, uuid, boolean) TO authenticated;

-- ── 6) o sócio vê os próprios pedidos ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agente_pedidos_meus(p_limite integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); d record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio'); END IF;
  SELECT * INTO d FROM erp_agente_dono WHERE user_id = v_uid ORDER BY ativo DESC LIMIT 1;
  IF NOT FOUND OR d.remetente_chat IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tem_code', false, 'pedidos', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'tem_code', true, 'agente', d.agente, 'ativo', d.ativo, 'remetente', d.remetente_chat,
    'carteira', coalesce((
      SELECT jsonb_agg(jsonb_build_object('company_id', c.id, 'nome', coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social))
                       ORDER BY coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social))
        FROM erp_carteira_responsavel k JOIN companies c ON c.id = k.company_id
       WHERE k.responsavel_id = v_uid AND k.vigencia_fim IS NULL), '[]'::jsonb),
    'pedidos', coalesce((
      SELECT jsonb_agg(p ORDER BY (p->>'criado_em') DESC) FROM (
        SELECT jsonb_build_object('id', m.id, 'assunto', m.assunto, 'status', m.status, 'pr_numero', m.pr_numero,
                 'resposta', m.resposta, 'requer_ok_ceo', m.requer_ok_ceo, 'ok_ceo_em', m.ok_ceo_em,
                 'chamado_numero', m.chamado_numero, 'empresa_id', m.empresa_id,
                 'acionamento', m.acionamento->>'motivo', 'acionou', (m.acionamento->>'acionou')::boolean,
                 'criado_em', m.criado_em, 'atualizado_em', m.atualizado_em) AS p
          FROM erp_agente_mensagem m
         WHERE m.de = d.remetente_chat AND m.para = d.agente
         ORDER BY m.criado_em DESC
         LIMIT least(greatest(coalesce(p_limite, 30), 1), 100)) x), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_pedidos_meus(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_pedidos_meus(integer) TO authenticated;
