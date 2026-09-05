-- Atendimento · separar QUEM REDIGIU de QUEM APROVOU (o CEO viu a resposta do #18 e disse
-- "essa resposta não fui eu que fiz"). O modelo gravava atendente_id = quem chamou a RPC; quando
-- o assistente redige (operado por um humano), o texto chegava ao cliente como se fosse do CEO.
-- Regra da casa (mesma do `origem` no tempo padrão e do ia_analise rotulado): quem PRODUZIU o texto
-- fica registrado. A aprovação já existia (resposta_aprovada_por); falta o autor do rascunho.

ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS resposta_redigida_por uuid,
  ADD COLUMN IF NOT EXISTS resposta_origem text;   -- 'humano' | 'assistente'

-- fn ganha p_redigida_por + p_origem (defaults mantêm as chamadas de 3 args do front funcionando).
DROP FUNCTION IF EXISTS public.fn_sugestao_responder(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.fn_sugestao_responder(
  p_id uuid, p_texto text, p_user uuid,
  p_redigida_por uuid DEFAULT NULL, p_origem text DEFAULT 'humano')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_origem text := CASE WHEN lower(btrim(COALESCE(p_origem,''))) = 'assistente' THEN 'assistente' ELSE 'humano' END;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(btrim(p_texto),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_vazia'); END IF;

  UPDATE sugestoes SET
    resposta = p_texto,
    resposta_aprovada = false, resposta_aprovada_por = NULL, resposta_aprovada_em = NULL,
    atendente_id = COALESCE(atendente_id, p_user),
    -- quem REDIGIU: se humano, a pessoa (p_redigida_por, ou o próprio p_user); se assistente, fica NULL
    -- (o rótulo vem de resposta_origem, não de uma pessoa)
    resposta_redigida_por = CASE WHEN v_origem = 'assistente' THEN NULL ELSE COALESCE(p_redigida_por, p_user) END,
    resposta_origem = v_origem,
    status = CASE WHEN status IN ('nova','em_analise') THEN 'em_desenvolvimento' ELSE status END,
    updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'aguardando_aprovacao', true, 'origem', v_origem);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_responder(uuid, text, uuid, uuid, text) TO authenticated;

-- Backfill: as respostas #18 (Rodrigo E0370) e #20 (Jordana) foram REDIGIDAS pelo assistente nesta
-- sessão (04/09) e gravadas com atendente_id do CEO. Marca a origem — senão a trilha nasce mentindo.
-- Guardado (só onde ainda não há origem) e escopado a esses dois chamados. As demais respostas ficam
-- com origem NULL (desconhecida) até serem confirmadas — não afirmamos o que não sabemos (RD-38).
UPDATE public.sugestoes SET resposta_origem = 'assistente', resposta_redigida_por = NULL
 WHERE numero IN (18, 20) AND resposta_origem IS NULL;

-- A view da fila é curada — expõe os novos campos + o NOME de quem redigiu e de quem aprovou,
-- pra tela mostrar "Rascunho escrito por … · aprovado por …". CREATE OR REPLACE só anexa colunas no fim.
CREATE OR REPLACE VIEW public.v_sugestao_fila AS
 SELECT s.id, s.company_id, c.nome_fantasia AS empresa, s.user_email, s.user_name, s.tipo, s.titulo, s.descricao,
    s.categoria, s.prioridade, s.status, s.rota, s.area, s.atendente_id, s.pr_numero, s.resposta, s.concluido_em,
    s.ia_analise IS NOT NULL AS tem_ia, s.ia_analise, s.ia_analisado_em,
    (SELECT count(*) FROM sugestao_anexo a WHERE a.sugestao_id = s.id) AS n_anexos,
    s.created_at, (EXTRACT(epoch FROM now() - s.created_at) / 86400::numeric)::integer AS dias_aberta,
    s.resposta_aprovada, s.resposta_aprovada_em, s.confirmado_pelo_autor, s.confirmado_em, s.numero,
    s.erro_assinatura, s.origem_sugestao_id,
    (SELECT sm.erro_comparacao FROM sugestao_mensagem sm WHERE sm.sugestao_id = s.id AND sm.erro_comparacao IS NOT NULL ORDER BY sm.criado_em DESC LIMIT 1) AS ultimo_erro_comparacao,
    s.resposta_redigida_por, s.resposta_origem, s.resposta_aprovada_por,
    (SELECT COALESCE(u.full_name, u.email) FROM users u WHERE u.id = s.resposta_aprovada_por) AS aprovador_nome,
    (SELECT COALESCE(u.full_name, u.email) FROM users u WHERE u.id = s.resposta_redigida_por) AS redator_nome
 FROM sugestoes s LEFT JOIN companies c ON c.id = s.company_id;
