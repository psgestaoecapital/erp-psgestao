-- Central de Melhorias: ciclo FECHADO (aprovar → avisar → confirmar), sem repasse manual.
--
-- Origem: o CEO teve que mandar a resposta ao Rodrigo por fora (WhatsApp). Se ele precisa repassar,
-- a Central não fechou o ciclo. Regra do CEO: "isso já tem que ser automático com o chamado. Eu só
-- preciso aprovar." Fluxo: PS escreve resposta (rascunho) → CEO aprova (um toque) → o AUTOR é avisado
-- (por PESSOA) → o autor confirma se resolveu → chamado vira concluida. Nenhuma mensagem fora do sistema.

-- (2.1) sugestoes ganha o passo de aprovação + a confirmação do autor.
ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS resposta_aprovada boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS resposta_aprovada_por uuid,
  ADD COLUMN IF NOT EXISTS resposta_aprovada_em timestamptz,
  ADD COLUMN IF NOT EXISTS confirmado_pelo_autor boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz;

-- (2.2) sugestao_notificacao — o aviso é por PESSOA (destinatario_id), NÃO por empresa.
-- erp_alerta_proativo foi avaliado e RECUSADO (RD-26): é por empresa, sem user_id — avisaria a empresa
-- inteira que o Rodrigo teve um bug. Chamado é conversa entre DUAS pessoas.
CREATE TABLE IF NOT EXISTS public.sugestao_notificacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sugestao_id uuid NOT NULL REFERENCES public.sugestoes(id) ON DELETE CASCADE,
  destinatario_id uuid NOT NULL,          -- quem abriu o chamado (ou PS, quando reaberto)
  tipo text NOT NULL,                      -- resposta | status | pedido_confirmacao | reaberto
  titulo text NOT NULL,
  mensagem text,
  lida boolean DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sugestao_notif_dest ON public.sugestao_notificacao (destinatario_id, lida, criado_em DESC);

ALTER TABLE public.sugestao_notificacao ENABLE ROW LEVEL SECURITY;
-- Ver: o próprio destinatário, ou a fila de suporte PS.
DROP POLICY IF EXISTS sugestao_notif_sel ON public.sugestao_notificacao;
CREATE POLICY sugestao_notif_sel ON public.sugestao_notificacao FOR SELECT
  USING (destinatario_id = auth.uid() OR public.fn_pode_ver_fila_suporte());
-- Marcar como lida: só o próprio destinatário.
DROP POLICY IF EXISTS sugestao_notif_upd ON public.sugestao_notificacao;
CREATE POLICY sugestao_notif_upd ON public.sugestao_notificacao FOR UPDATE
  USING (destinatario_id = auth.uid()) WITH CHECK (destinatario_id = auth.uid());

-- (3.1) fn_sugestao_responder: grava a resposta em RASCUNHO (resposta_aprovada=false). NÃO notifica.
--       Antes disso a resposta existe e o CEO vê — mas o autor NÃO (regra §2.1).
CREATE OR REPLACE FUNCTION public.fn_sugestao_responder(p_id uuid, p_texto text, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(btrim(p_texto),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_vazia'); END IF;

  UPDATE sugestoes SET
    resposta = p_texto,
    resposta_aprovada = false, resposta_aprovada_por = NULL, resposta_aprovada_em = NULL,
    atendente_id = COALESCE(atendente_id, p_user),
    status = CASE WHEN status IN ('nova','em_analise') THEN 'em_desenvolvimento' ELSE status END,
    updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'aguardando_aprovacao', true);
END $function$;

-- (3.2) fn_sugestao_aprovar_resposta: SÓ PS_ADMIN (support escreve, admin aprova — a aprovação é um
--       segundo par de olhos, não formalidade). Marca aprovada E cria a notificação ao AUTOR.
CREATE OR REPLACE FUNCTION public.fn_sugestao_aprovar_resposta(p_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_resp text; v_titulo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role = 'PS_ADMIN') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ps_admin_aprova'); END IF;
  SELECT user_id, resposta, titulo INTO v_autor, v_resp, v_titulo FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF COALESCE(btrim(v_resp),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_para_aprovar'); END IF;

  UPDATE sugestoes SET
    resposta_aprovada = true, resposta_aprovada_por = p_user, resposta_aprovada_em = now(), updated_at = now()
  WHERE id = p_id;

  -- notifica o AUTOR (por pessoa). Só aqui a resposta passa a ser visível a ele.
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_id, v_autor, 'resposta',
          'Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.');

  RETURN jsonb_build_object('ok', true, 'notificado', v_autor);
END $function$;

-- (3.3) fn_sugestao_confirmar: SÓ o autor. Funcionou → concluida (com data). Não resolveu → reabre em
--       em_desenvolvimento com o motivo (exigido) e avisa a fila PS. RD-38: quem diz que resolveu é
--       quem abriu — merge não conclui.
CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmar(p_id uuid, p_user uuid, p_funcionou boolean, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean;
BEGIN
  SELECT user_id, resposta_aprovada INTO v_autor, v_aprovada FROM sugestoes WHERE id = p_id;
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
      resposta_aprovada = false,          -- a resposta anterior não resolveu: volta pro rascunho
      updated_at = now() WHERE id = p_id;
    -- avisa a fila PS que o autor reabriu, com o motivo dele
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', 'Chamado reaberto pelo autor', p_motivo
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT');
    RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
  END IF;
END $function$;

-- (4) v_sugestao_fila expõe o estado de aprovação/confirmação para a tela de atendimento.
-- CREATE OR REPLACE VIEW só permite ACRESCENTAR colunas no FIM — mantém a ordem original e adiciona
-- as novas ao final (senão o replace falha).
CREATE OR REPLACE VIEW public.v_sugestao_fila AS
 SELECT s.id, s.company_id, c.nome_fantasia AS empresa, s.user_email, s.user_name, s.tipo,
    s.titulo, s.descricao, s.categoria, s.prioridade, s.status, s.rota, s.area, s.atendente_id,
    s.pr_numero, s.resposta, s.concluido_em,
    (s.ia_analise IS NOT NULL) AS tem_ia, s.ia_analise, s.ia_analisado_em,
    (SELECT count(*) AS count FROM sugestao_anexo a WHERE a.sugestao_id = s.id) AS n_anexos,
    s.created_at,
    ((EXTRACT(epoch FROM (now() - s.created_at)) / 86400::numeric))::integer AS dias_aberta,
    s.resposta_aprovada, s.resposta_aprovada_em, s.confirmado_pelo_autor, s.confirmado_em
   FROM sugestoes s
     LEFT JOIN companies c ON c.id = s.company_id;
