-- #7050 opção A (decisão jordana-chat/eng — manter o modelo atual de sinais do quadro; NÃO criar
-- status novos): dar à equipe PS uma NOTA INTERNA no chamado e automatizar a coluna do quadro.
--
-- Entregas desta migration (aditiva, sem tocar dado de cliente):
--  1. Marcador `nota_interna` em sugestao_mensagem (default false → nenhuma linha existente muda).
--  2. RLS: o AUTOR do chamado (quem não é da fila de suporte) NÃO vê nota interna. A PS continua
--     vendo tudo (fn_pode_ver_fila_suporte). Como tudo que existe hoje é nota_interna=false, nenhuma
--     visibilidade atual muda.
--  3. Sinal DEDICADO `aguardando_usuario` em sugestoes (default false → nenhuma linha existente muda).
--     fn_sugestao_mensagem_enviar ganha p_nota_interna (só a PS marca; a mensagem do autor é sempre
--     visível). Regra do quadro:
--       - mensagem VISÍVEL da PS → marca sugestoes.aguardando_usuario = true → coluna "Aguardando usuário";
--       - NOTA INTERNA → não notifica o autor, não muda a coluna;
--       - o retorno do autor zera aguardando_usuario (trg_sugestao_autor_respondeu) → volta a "Em andamento".
--
-- CORREÇÃO DO BLOQUEADOR LGPD (AJUSTES gilberto-revisor 20/11, RD-38): a versão anterior marcava
-- `resposta_aprovada = true` para mover a coluna. Mas `resposta_aprovada` é SOBRECARREGADO: além do
-- Kanban, é o portão que (a) revela o rascunho interno `sugestoes.resposta` ao AUTOR
-- (melhorias/page.tsx: resposta só aparece quando resposta_aprovada) e (b) tira o chamado da fila
-- "Precisa de mim" do operador (filaAtendimento: temRascunho = resposta E !resposta_aprovada).
-- Em 2.384 chamados de produção com rascunho interno NÃO aprovado (resposta preenchida,
-- resposta_aprovada=false, resposta_aprovada_em IS NULL), uma mensagem visível vazaria o rascunho ao
-- cliente e sumiria o chamado da aprovação. Por isso a coluna agora usa um sinal PRÓPRIO
-- (aguardando_usuario) e NÃO toca resposta_aprovada. Prova RD-38 (BEGIN…ROLLBACK, caso real #10901):
-- setar aguardando_usuario=true mantém resposta_aprovada=false, resposta_aprovada_em=null e a projeção
-- do autor (resposta_aprovada) continua false → rascunho segue oculto; coluna vai p/ "Aguardando usuário".
--
-- Faixa de migration jordana-code = segundos :20. Sensível (RLS + função SECURITY DEFINER do núcleo
-- de chamados) → revisao-eng-chefe.

-- 1) marcador de nota interna ---------------------------------------------------------------------
ALTER TABLE public.sugestao_mensagem
  ADD COLUMN IF NOT EXISTS nota_interna boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sugestao_mensagem.nota_interna IS
  '#7050 opção A: nota interna da equipe PS — não visível ao autor (RLS sugestao_msg_sel) e não move a coluna do quadro. Só a PS pode marcar true (fn_sugestao_mensagem_enviar).';

-- 1.1) sinal dedicado da coluna "Aguardando usuário" (NÃO reusa resposta_aprovada) -----------------
ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS aguardando_usuario boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sugestoes.aguardando_usuario IS
  '#7050 opção A: sinal do Kanban "Aguardando usuário" — marcado quando a PS envia uma mensagem VISÍVEL ao autor, zerado quando o autor responde (trg_sugestao_autor_respondeu). Separado de resposta_aprovada (que só significa rascunho aprovado) para não vazar rascunho interno nem furar a fila de aprovação.';

-- 2) RLS: autor não enxerga nota interna -----------------------------------------------------------
DROP POLICY IF EXISTS sugestao_msg_sel ON public.sugestao_mensagem;
CREATE POLICY sugestao_msg_sel ON public.sugestao_mensagem
  FOR SELECT
  USING (
    fn_pode_ver_fila_suporte()
    OR (
      nota_interna = false
      AND EXISTS (SELECT 1 FROM sugestoes s WHERE s.id = sugestao_mensagem.sugestao_id)
    )
  );

-- 3) view da fila expõe o sinal novo (CREATE OR REPLACE — acrescenta a coluna)
-- RD-79: CREATE OR REPLACE VIEW sem WITH reseta reloptions e desliga security_invoker (vaza chamados entre
-- empresas via authenticated). Reaplica security_invoker=true inline (conserto-main gilberto-esteira 23/11).
CREATE OR REPLACE VIEW public.v_sugestao_fila WITH (security_invoker = true) AS
 SELECT s.id,
    s.company_id,
    c.nome_fantasia AS empresa,
    s.user_email,
    s.user_name,
    s.tipo,
    s.titulo,
    s.descricao,
    s.categoria,
    s.prioridade,
    s.status,
    s.rota,
    s.area,
    s.atendente_id,
    s.pr_numero,
    s.resposta,
    s.concluido_em,
    s.ia_analise IS NOT NULL AS tem_ia,
    s.ia_analise,
    s.ia_analisado_em,
    ( SELECT count(*) AS count
           FROM sugestao_anexo a
          WHERE a.sugestao_id = s.id) AS n_anexos,
    s.created_at,
    (EXTRACT(epoch FROM now() - s.created_at) / 86400::numeric)::integer AS dias_aberta,
    s.resposta_aprovada,
    s.resposta_aprovada_em,
    s.confirmado_pelo_autor,
    s.confirmado_em,
    s.numero,
    s.erro_assinatura,
    s.origem_sugestao_id,
    ( SELECT sm.erro_comparacao
           FROM sugestao_mensagem sm
          WHERE sm.sugestao_id = s.id AND sm.erro_comparacao IS NOT NULL
          ORDER BY sm.criado_em DESC
         LIMIT 1) AS ultimo_erro_comparacao,
    s.resposta_redigida_por,
    s.resposta_origem,
    s.resposta_aprovada_por,
    ( SELECT COALESCE(u.full_name, u.email) AS "coalesce"
           FROM users u
          WHERE u.id = s.resposta_aprovada_por) AS aprovador_nome,
    ( SELECT COALESCE(u.full_name, u.email) AS "coalesce"
           FROM users u
          WHERE u.id = s.resposta_redigida_por) AS redator_nome,
    s.responsavel_id,
    ( SELECT e.nome_curto
           FROM erp_chamado_equipe e
          WHERE e.user_id = s.responsavel_id) AS responsavel_nome,
    ( SELECT COALESCE(e.nome_curto, split_part(COALESCE(u.full_name, u.email, ''::text), ' '::text, 1)) AS "coalesce"
           FROM users u
             LEFT JOIN erp_chamado_equipe e ON e.user_id = u.id
          WHERE u.id = s.atendente_id) AS atendente_nome,
    s.em_atendimento_desde,
    s.ultimo_movimento,
    s.interno,
    s.agente,
    s.ramo,
    s.aguardando_usuario
   FROM sugestoes s
     LEFT JOIN companies c ON c.id = s.company_id;

-- 4) retorno do autor zera o sinal da coluna -------------------------------------------------------
-- O autor respondeu: além de reabrir o rascunho (comportamento vivo) e zerar resposta_aprovada,
-- zera também aguardando_usuario → a coluna volta para "Em andamento".
CREATE OR REPLACE FUNCTION public.fn__sugestao_autor_respondeu()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.papel = 'autor' THEN
    UPDATE sugestoes s SET
      resposta = CASE WHEN EXISTS (SELECT 1 FROM sugestao_mensagem m
                                    WHERE m.sugestao_id = s.id AND m.papel = 'ps' AND btrim(m.texto) = btrim(s.resposta))
                      THEN NULL ELSE s.resposta END,
      resposta_aprovada = false,
      aguardando_usuario = false,
      updated_at = now()
     WHERE s.id = NEW.sugestao_id;
  END IF;
  RETURN NEW;
END $function$;

-- ACL da trigger: casa a ACL viva (service_role apenas; sem anon/authenticated) — exigência check_fn_guards [revoke_anon]
REVOKE ALL ON FUNCTION public.fn__sugestao_autor_respondeu() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__sugestao_autor_respondeu() TO service_role;

-- 5) envio com nota interna + automação da coluna --------------------------------------------------
-- A assinatura muda (novo parâmetro) → DROP da versão antiga e CREATE da nova, re-aplicando os grants
-- exatamente como estavam (authenticated, service_role; sem anon/PUBLIC).
DROP FUNCTION IF EXISTS public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.fn_sugestao_mensagem_enviar(
  p_sugestao_id uuid,
  p_user uuid,
  p_texto text DEFAULT NULL::text,
  p_anexos jsonb DEFAULT '[]'::jsonb,
  p_nota_interna boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_autor_chamado uuid; v_company uuid; v_titulo text; v_status text; v_numero int; v_resp uuid;
  v_papel text; v_msg_id uuid; v_email text; v_an jsonb; v_ord int := 0;
  v_tem_anexo boolean := (p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' AND jsonb_array_length(p_anexos) > 0);
  v_anexo_ids uuid[] := ARRAY[]::uuid[]; v_new_anexo uuid;
  v_nota_interna boolean;
BEGIN
  SELECT user_id, company_id, titulo, status, numero, responsavel_id INTO v_autor_chamado, v_company, v_titulo, v_status, v_numero, v_resp
    FROM sugestoes WHERE id = p_sugestao_id;
  IF v_autor_chamado IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;

  IF auth.uid() = v_autor_chamado THEN v_papel := 'autor';
  ELSIF is_admin() OR fn_pode_ver_fila_suporte() THEN v_papel := 'ps';
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- #7050 opção A: só a PS marca nota interna; a mensagem do autor é sempre visível.
  v_nota_interna := (v_papel = 'ps' AND COALESCE(p_nota_interna, false));

  IF COALESCE(btrim(p_texto),'') = '' AND NOT v_tem_anexo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_vazia'); END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, nota_interna)
  VALUES (p_sugestao_id, p_user, v_email, v_papel, NULLIF(btrim(p_texto),''), v_nota_interna)
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
    -- o cliente respondeu: a bola volta para a PS (sai de "aguardando confirmação" e reabre o que estava encerrado).
    -- aguardando_usuario também é zerado aqui (além do gatilho trg_sugestao_autor_respondeu) → volta para "Em andamento".
    UPDATE sugestoes SET
      status = CASE WHEN status IN ('concluida','recusada','duplicada','arquivada','aguardando_confirmacao') THEN 'em_desenvolvimento' ELSE status END,
      confirmado_pelo_autor = false, aguardando_usuario = false, updated_at = now(), ultimo_movimento = now()
    WHERE id = p_sugestao_id;
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_sugestao_id, u.id, 'mensagem',
           '#' || v_numero || ' · Nova mensagem no chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sem título'),
           left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200)
    FROM users u
    WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM')
       OR (u.id = v_resp AND v_resp <> v_autor_chamado);
  ELSIF v_nota_interna THEN
    -- #7050 opção A: nota interna não notifica o autor e não muda a coluna.
    NULL;
  ELSE
    -- #7050 opção A: mensagem VISÍVEL da PS → chamado para "Aguardando usuário" (sinal DEDICADO).
    -- NÃO mexe em resposta_aprovada: isso revelaria o rascunho interno ao autor e sumiria o chamado
    -- da fila de aprovação (bloqueador LGPD do AJUSTES 20/11). A coluna usa aguardando_usuario.
    UPDATE sugestoes SET
      aguardando_usuario = true, updated_at = now(), ultimo_movimento = now()
    WHERE id = p_sugestao_id;
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    VALUES (p_sugestao_id, v_autor_chamado, 'mensagem',
            '#' || v_numero || ' · Nova mensagem no seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
            left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200));
  END IF;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg_id, 'papel', v_papel,
                            'nota_interna', v_nota_interna,
                            'anexos', to_jsonb(v_anexo_ids), 'tem_foto', v_tem_anexo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb, boolean) TO authenticated, service_role;
