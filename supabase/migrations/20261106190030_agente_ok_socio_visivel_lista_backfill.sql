-- #6696 (rodrigo-code): o pedido de OK do sócio não aparecia para o Rodrigo. Causas provadas no dado/código:
--  (1) fn_agente_ok_socio_pendente só devolvia mensagem em nova/recebida/em_andamento — pedidos de mensagens já
--      'concluida' (6d9ecdc3, 9fc07d18) ficavam invisíveis mesmo ligados ao chamado;
--  (2) fn_agente_ok_socio recusava 'concluida' ('sem_pedido_aberto'), então nem aprovando dava;
--  (3) a tela só montava o bloco para quem é suporte PS (o autor/sócio nunca via);
--  (4) pedidos sem sugestao_id (d93cd9c1, 010bb0b6, fb4e2a51, e9e4c84b) não aparecem por chamado.
-- Aditiva/idempotente. A segurança segue no banco: só o sócio dono do agente (auth.uid()) enxerga/decide.

CREATE OR REPLACE FUNCTION public.fn_agente_ok_socio_pendente(p_sugestao uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT jsonb_build_object('mensagem_id', m.id, 'agente', m.para, 'texto', m.pedido_ok_socio, 'pedido_em', m.pedido_ok_socio_em)
      FROM erp_agente_mensagem m JOIN erp_agente_escopo e ON e.agente = m.para AND e.ativo AND e.socio_user_id = auth.uid()
     WHERE m.sugestao_id = p_sugestao AND m.pedido_ok_socio IS NOT NULL AND m.ok_socio_decisao IS NULL
       AND NOT m.arquivada AND m.status <> 'recusada'
     ORDER BY m.pedido_ok_socio_em DESC LIMIT 1), 'null'::jsonb);
$function$;

-- ci-sem-guarda: fn_agente_ok_socio — mensagem do agente não tem empresa; a guarda é o escopo: só o sócio dono do agente (erp_agente_escopo.socio_user_id = auth.uid())
CREATE OR REPLACE FUNCTION public.fn_agente_ok_socio(p_mensagem_id uuid, p_decisao text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE m record; v_uid uuid := auth.uid();
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
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id, 'decisao', p_decisao);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_ok_socio_pendente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio_pendente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio_pendente(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio(uuid, text) TO authenticated, service_role;

-- Lista de "Aprovações pendentes" do sócio logado (ligadas ou não a chamado). Outro usuário recebe lista vazia.
CREATE OR REPLACE FUNCTION public.fn_agente_ok_socio_lista()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'mensagem_id', m.id, 'agente', m.para, 'texto', m.pedido_ok_socio, 'pedido_em', m.pedido_ok_socio_em,
           'sugestao_id', m.sugestao_id, 'chamado_numero', s.numero) ORDER BY m.pedido_ok_socio_em DESC), '[]'::jsonb)
    FROM erp_agente_mensagem m
    JOIN erp_agente_escopo e ON e.agente = m.para AND e.ativo AND e.socio_user_id = auth.uid()
    LEFT JOIN sugestoes s ON s.id = m.sugestao_id
   WHERE m.pedido_ok_socio IS NOT NULL AND m.ok_socio_decisao IS NULL AND NOT m.arquivada AND m.status <> 'recusada';
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio_lista() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio_lista() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio_lista() TO authenticated, service_role;

-- Backfill do vínculo (só mensagens internas do rodrigo-code; nenhum dado de cliente muda).
UPDATE erp_agente_mensagem SET sugestao_id = '0558d7d4-546c-40e1-a7a6-54a7b084ab7e'   -- #5622
 WHERE para = 'rodrigo-code' AND id::text LIKE 'd93cd9c1%' AND sugestao_id IS NULL AND ok_socio_decisao IS NULL;
UPDATE erp_agente_mensagem SET sugestao_id = '4de5b8e6-a25b-4223-9934-8610c354f2ff'   -- #5678
 WHERE para = 'rodrigo-code' AND id::text LIKE '010bb0b6%' AND sugestao_id IS NULL AND ok_socio_decisao IS NULL;
-- repetidos: fb4e2a51 (#5678+#5659) já coberto por 010bb0b6 (#5678) + 9fc07d18 (#5659); e9e4c84b (#5616/#5620) o Rodrigo confirmou em 03/11
UPDATE erp_agente_mensagem SET arquivada = true, atualizado_em = now()
 WHERE para = 'rodrigo-code' AND (id::text LIKE 'fb4e2a51%' OR id::text LIKE 'e9e4c84b%') AND ok_socio_decisao IS NULL AND NOT arquivada;
-- pedidos ligados que estavam 'concluida' voltam a aguardar o OK (o Code posta a resposta depois de aprovado)
UPDATE erp_agente_mensagem SET status = 'em_andamento', aguardando_em = now(), aguardando_motivo = 'aguardando OK do Rodrigo', atualizado_em = now()
 WHERE para = 'rodrigo-code' AND status = 'concluida' AND pedido_ok_socio IS NOT NULL AND ok_socio_decisao IS NULL
   AND sugestao_id IS NOT NULL AND NOT arquivada;

-- Ajuda (RD-95) dos botões da lista "Aprovações pendentes".
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, '/dashboard/melhorias', 'Aprovações pendentes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, 'geral', v.ordem
FROM (VALUES
 ('aprovacoes.aprovar', 'Aprovar', 'Botão de ação — não se preenche nada. Leia o texto do pedido antes de clicar.',
  'Autoriza o Code a registrar no chamado exatamente o texto mostrado. Sem a sua aprovação, nada é enviado ao autor do chamado.',
  'O pedido diz "Corrigido e publicado". Você conferiu na tela, clica em Aprovar e a resposta segue para o autor.',
  'Aprovar sem ler o texto inteiro. O que está escrito no pedido é o que será publicado.', 1),
 ('aprovacoes.recusar', 'Recusar', 'Botão de ação — não se preenche nada.',
  'Impede que o texto seja publicado no chamado. O Code vê a recusa e não envia nada.',
  'O texto não explica bem a correção. Você clica em Recusar e pede ao Code que reescreva.',
  'Recusar achando que isso fecha ou apaga o chamado. Ele só barra aquele texto.', 2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM erp_ajuda_campo a WHERE a.chave = v.chave);
