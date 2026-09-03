-- Chamado ganha NÚMERO curto, global e sequencial (#1, #2, …) — para falar no telefone.
--
-- Hoje o chamado só tem UUID: ninguém dita "7ac7b7c4-c235-4c6b" no telefone. O suporte precisa de uma
-- referência falável ("olha o chamado #14"). Mecânica REUSADA (RD-26): igual erp_mudancas.numero —
-- integer DEFAULT nextval(sequence GLOBAL). Global (não por empresa) porque a fila é única e o suporte
-- atende todo mundo. Ordem = criação: o chamado mais antigo é #1 (o 1º do Rodrigo, "Adicionar botão de
-- IA" de 07/04, vira #1).

-- (1) sequence global + coluna
CREATE SEQUENCE IF NOT EXISTS public.sugestoes_numero_seq;
ALTER TABLE public.sugestoes ADD COLUMN IF NOT EXISTS numero integer;

-- (2) backfill por ORDEM DE CRIAÇÃO (mais antigo = #1). Idempotente: só numera quem ainda não tem.
WITH ord AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.sugestoes WHERE numero IS NULL
)
UPDATE public.sugestoes s SET numero = ord.rn FROM ord WHERE s.id = ord.id;

-- (3) a sequence continua DEPOIS do maior número já atribuído (setval com is_called conforme houver linhas)
SELECT setval('public.sugestoes_numero_seq',
              GREATEST((SELECT COALESCE(max(numero),0) FROM public.sugestoes), 1),
              (SELECT COALESCE(max(numero),0) FROM public.sugestoes) > 0);

-- (4) a partir de agora todo chamado nasce numerado; único e obrigatório
ALTER TABLE public.sugestoes ALTER COLUMN numero SET DEFAULT nextval('public.sugestoes_numero_seq');
ALTER TABLE public.sugestoes ALTER COLUMN numero SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sugestoes_numero ON public.sugestoes(numero);

-- (5) expõe o número na fila (append no FIM — CREATE OR REPLACE VIEW só acrescenta colunas ao final)
CREATE OR REPLACE VIEW public.v_sugestao_fila AS
 SELECT s.id, s.company_id, c.nome_fantasia AS empresa, s.user_email, s.user_name, s.tipo,
    s.titulo, s.descricao, s.categoria, s.prioridade, s.status, s.rota, s.area, s.atendente_id,
    s.pr_numero, s.resposta, s.concluido_em,
    (s.ia_analise IS NOT NULL) AS tem_ia, s.ia_analise, s.ia_analisado_em,
    (SELECT count(*) AS count FROM sugestao_anexo a WHERE a.sugestao_id = s.id) AS n_anexos,
    s.created_at,
    ((EXTRACT(epoch FROM (now() - s.created_at)) / 86400::numeric))::integer AS dias_aberta,
    s.resposta_aprovada, s.resposta_aprovada_em, s.confirmado_pelo_autor, s.confirmado_em,
    s.numero
   FROM sugestoes s
     LEFT JOIN companies c ON c.id = s.company_id;

-- (6) o NÚMERO entra no ASSUNTO das notificações — é a referência que se fala no telefone.
--     Três RPCs criam notificação de chamado: aprovar_resposta, confirmar (reaberto) e mensagem_enviar.

CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text; v_numero int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role = 'PS_ADMIN') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo, numero INTO v_autor, v_resp, v_titulo, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;

  UPDATE sugestoes SET
    resposta_aprovada = true, resposta_aprovada_por = p_user, resposta_aprovada_em = now(), updated_at = now()
  WHERE id = p_id;

  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_id, v_autor, 'resposta',
          '#' || v_numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.');

  RETURN jsonb_build_object('ok', true, 'notificado', v_autor);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmar(p_id uuid, p_user uuid, p_funcionou boolean, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean; v_numero int;
BEGIN
  SELECT user_id, resposta_aprovada, numero INTO v_autor, v_aprovada, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() <> v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_confirma'); END IF;
  IF NOT COALESCE(v_aprovada, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_aprovada'); END IF;

  IF p_funcionou THEN
    UPDATE sugestoes SET confirmado_pelo_autor = true, confirmado_em = now(),
      status = 'concluida', concluido_em = now(), updated_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 'concluida');
  ELSE
    IF COALESCE(btrim(p_motivo),'') = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
    UPDATE sugestoes SET confirmado_pelo_autor = false, status = 'em_desenvolvimento',
      resposta_aprovada = false,
      updated_at = now() WHERE id = p_id;
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', p_motivo
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT');
    RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_mensagem_enviar(
    p_sugestao_id uuid, p_user uuid, p_texto text DEFAULT NULL, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_autor_chamado uuid; v_company uuid; v_titulo text; v_status text; v_numero int;
  v_papel text; v_msg_id uuid; v_email text; v_an jsonb; v_ord int := 0;
  v_tem_anexo boolean := (p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' AND jsonb_array_length(p_anexos) > 0);
  v_anexo_ids uuid[] := ARRAY[]::uuid[]; v_new_anexo uuid;
BEGIN
  SELECT user_id, company_id, titulo, status, numero INTO v_autor_chamado, v_company, v_titulo, v_status, v_numero
    FROM sugestoes WHERE id = p_sugestao_id;
  IF v_autor_chamado IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;

  IF auth.uid() = v_autor_chamado THEN v_papel := 'autor';
  ELSIF is_admin() OR fn_pode_ver_fila_suporte() THEN v_papel := 'ps';
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF COALESCE(btrim(p_texto),'') = '' AND NOT v_tem_anexo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_vazia'); END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_sugestao_id, p_user, v_email, v_papel, NULLIF(btrim(p_texto),''))
  RETURNING id INTO v_msg_id;

  IF v_tem_anexo THEN
    FOR v_an IN SELECT * FROM jsonb_array_elements(p_anexos) LOOP
      INSERT INTO sugestao_anexo (sugestao_id, mensagem_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
      VALUES (p_sugestao_id, v_msg_id, v_company, v_an->>'storage_path', v_an->>'url_publica',
              COALESCE(v_an->>'tipo','imagem'), COALESCE(v_an->'marcacoes','[]'::jsonb), v_ord, p_user)
      RETURNING id INTO v_new_anexo;
      v_anexo_ids := v_anexo_ids || v_new_anexo;
      v_ord := v_ord + 1;
    END LOOP;
  END IF;

  IF v_papel = 'autor' THEN
    UPDATE sugestoes SET
      status = CASE WHEN status IN ('concluida','recusada','duplicada','arquivada') THEN 'em_desenvolvimento' ELSE status END,
      confirmado_pelo_autor = false, updated_at = now()
    WHERE id = p_sugestao_id;
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_sugestao_id, u.id, 'mensagem',
           '#' || v_numero || ' · Nova mensagem no chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sem título'),
           left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200)
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT');
  ELSE
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    VALUES (p_sugestao_id, v_autor_chamado, 'mensagem',
            '#' || v_numero || ' · Nova mensagem no seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
            left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200));
  END IF;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg_id, 'papel', v_papel,
                            'anexos', to_jsonb(v_anexo_ids), 'tem_foto', v_tem_anexo);
END $function$;
