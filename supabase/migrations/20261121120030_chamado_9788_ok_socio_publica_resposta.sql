-- Chamado #9788 (CEO 19/11) — "Aprovações pendentes voltam após aprovar" (casos #8620, #8622).
--
-- CAUSA RAIZ PROVADA NO DADO (RD-38): o bloco "Aprovações pendentes" (AprovacoesPendentes.tsx) é o fluxo
-- de OK do SÓCIO — fn_agente_ok_socio_lista / fn_agente_ok_socio — e NÃO o fn_sugestao_aprovar_resposta.
-- O clique em "Aprovar" PERSISTE (ok_socio_decisao='aprovado') e o item SAI da lista. O que falta: a
-- resposta aprovada NUNCA é publicada ao cliente nem o chamado avança. fn_agente_ok_socio só carimbava a
-- decisão e dependia de o Code chamar fn_agente_chamado_responder depois — mas a tarefa do Code já foi
-- concluída e ninguém o reacorda. O chamado fica 'nova', e o roteador (fn_chamados_rotear, de hora em hora)
-- cria uma NOVA tarefa → o Code redige um NOVO pedido_ok_socio → reaparece em "Aprovações pendentes".
-- Prova: #8620 e #8622 = status 'nova', resposta_aprovada=false, 0 mensagens 'ps', 2 aprovações de sócio cada.
--
-- CORREÇÃO (uma transação só): ao aprovar (fn_agente_ok_socio = 'aprovado'), PUBLICAR a resposta aprovada
-- ao cliente e AVANÇAR o chamado para 'aguardando_confirmacao' — exatamente como o ramo do sócio de
-- fn_agente_chamado_responder: autor = conta PS de erp_agente_config (NUNCA forjado), rastro
-- ok_ceo_origem='ok_socio', aprovado_por = o sócio logado, mesma notificação 'resposta' que a fila oficial
-- fn_sugestao_email_fila envia. O humano (sócio) aprova no ATO → respeita a regra #7050 "nenhuma resposta
-- ao cliente sem humano aprovar" (CEO 09/11). Publicado, o chamado vira 'aguardando_confirmacao', que o
-- roteador JÁ exclui → não reabre. É o mesmo efeito que fn_sugestao_aprovar_resposta / responder produzem.
--
-- NÃO toca fn_agente_chamado_responder (caminho oficial do Code, com gate próprio) nem os crons (o avanço
-- de status já tira o chamado do roteador). IDEMPOTENTE: só publica se ainda não há resposta aprovada e não
-- existe mensagem 'ps' igual; dupla aprovação cai no guard 'ja_decidido'. Não apaga nada, não muda
-- frequência de cron, não forja identidade. Bug interno de chamados (sugestoes) — texto publicado é o que o
-- próprio sócio aprovou. Mantém auth.uid() = sócio do agente ('so_o_socio_dono') e grant só authenticated.

-- ci-sem-guarda: fn_agente_ok_socio — guarda por ESCOPO de sócio, não por empresa: só o sócio dono do agente
--   (erp_agente_escopo, auth.uid()=socio_user_id) e só em chamado do próprio escopo (fn__agente_escopo_chamado_i).
--   Chamado interno (sugestoes) atravessa as empresas da carteira do sócio — não há "empresa do registro" a conferir.
--   Mesmo modelo do caminho oficial irmão fn_agente_chamado_responder.
CREATE OR REPLACE FUNCTION public.fn_agente_ok_socio(p_mensagem_id uuid, p_decisao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record; v_uid uuid := auth.uid();
  v_sug uuid; v_texto text; v_ceo_user uuid; v_ceo_email text; s record;
  v_hash text; v_status text; v_publicado boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF p_decisao IS NULL OR p_decisao NOT IN ('aprovado','recusado') THEN RETURN jsonb_build_object('ok', false, 'erro', 'decisao_invalida'); END IF;
  SELECT msg.* INTO m FROM erp_agente_mensagem msg WHERE msg.id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_escopo e WHERE e.agente = m.para AND e.ativo AND e.socio_user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_o_socio_dono'); END IF;
  IF m.pedido_ok_socio IS NULL OR m.status = 'recusada' OR m.arquivada THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_pedido_aberto'); END IF;
  IF m.ok_socio_decisao IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_decidido', 'decisao', m.ok_socio_decisao); END IF;

  UPDATE erp_agente_mensagem SET ok_socio_decisao = p_decisao, ok_socio_em = now(), ok_socio_por = v_uid, atualizado_em = now()
   WHERE id = p_mensagem_id;

  -- Aprovado: publicar a resposta ao cliente e avançar o chamado, na MESMA transação (ramo do sócio de
  -- fn_agente_chamado_responder). O sócio aprovou => ação humana no ato (regra #7050). Sem isso, o chamado
  -- ficava 'nova' e o roteador recriava a aprovação a cada hora ("voltam após aprovar").
  IF p_decisao = 'aprovado' THEN
    v_sug := m.sugestao_id;
    IF v_sug IS NULL AND m.chamado_numero IS NOT NULL THEN
      SELECT id INTO v_sug FROM sugestoes WHERE numero = m.chamado_numero LIMIT 1;
    END IF;
    v_texto := btrim(COALESCE(m.pedido_ok_socio, ''));
    IF v_sug IS NOT NULL AND v_texto <> '' AND public.fn__agente_escopo_chamado_i(m.para, v_sug) THEN
      -- autor = conta PS configurada (erp_agente_config), PS_ADMIN de verdade; nunca forjado nem parâmetro
      SELECT u.id, u.email INTO v_ceo_user, v_ceo_email FROM users u
       WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'))
         AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM');
      SELECT id, user_id, numero, titulo, status, resposta_aprovada INTO s FROM sugestoes WHERE id = v_sug FOR UPDATE;
      IF v_ceo_user IS NOT NULL AND s.user_id IS NOT NULL
         AND COALESCE(s.resposta_aprovada, false) = false
         AND NOT EXISTS (SELECT 1 FROM sugestao_mensagem sm WHERE sm.sugestao_id = v_sug AND sm.papel = 'ps' AND btrim(sm.texto) = v_texto) THEN
        v_hash := encode(sha256(convert_to(v_texto, 'UTF8')), 'hex');
        v_status := CASE WHEN s.status IN ('nova','em_analise','aceita','em_desenvolvimento') OR s.status IS NULL
                         THEN 'aguardando_confirmacao' ELSE s.status END;
        INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em,
                                       redigido_por, aprovado_por, ok_ceo_em, mensagem_agente_id, texto_hash, ok_ceo_origem, ok_registrado_por)
        VALUES (v_sug, v_ceo_user, v_ceo_email, 'ps', v_texto, now(),
                m.para, v_uid, now(), m.id, v_hash, 'ok_socio', v_uid::text);
        UPDATE sugestoes SET resposta = v_texto, resposta_aprovada = true, resposta_aprovada_por = v_uid, resposta_aprovada_em = now(),
               status = v_status, confirmado_pelo_autor = false, updated_at = now()
         WHERE id = v_sug;
        INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem, email_status, email_proxima_tentativa)
        VALUES (v_sug, s.user_id, 'resposta', '#' || s.numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(s.titulo),''), 'sua sugestão'),
                'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.', 'pendente', now());
        v_publicado := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id, 'decisao', p_decisao, 'publicado', v_publicado);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_ok_socio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio(uuid, text) TO authenticated, service_role;
