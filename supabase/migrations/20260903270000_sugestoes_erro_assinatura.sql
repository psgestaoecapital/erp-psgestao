-- Assinatura de erro + comparação entre camadas — "não funcionou" deixa de esconder progresso.
--
-- Problema de processo (CEO): o Rodrigo diz "não funcionou, segue com erro" — verdade do lado dele
-- (não salva). Do nosso, a correção pegou: o erro MUDOU (ON CONFLICT → violação de RLS). Três "não
-- funcionou" podem ser três camadas descascadas, não estagnação; e o inverso (achar que mudou quando
-- não mudou) é pior. A IA já lê a mensagem de erro da foto — falta GUARDAR normalizada e COMPARAR.
--
-- Regra: comparação é mecânica, nunca pergunta ao usuário (ele não sabe se o erro é o mesmo). Sem erro
-- legível → diz que não conseguiu comparar, nunca chuta.

-- (1) assinatura no chamado e na mensagem; comparação e "antes" na mensagem; link de desmembramento.
ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS erro_assinatura text,
  ADD COLUMN IF NOT EXISTS origem_sugestao_id uuid REFERENCES public.sugestoes(id);
ALTER TABLE public.sugestao_mensagem
  ADD COLUMN IF NOT EXISTS erro_assinatura text,
  ADD COLUMN IF NOT EXISTS erro_comparacao text,          -- mesmo | mudou | sem_comparacao | NULL(primeiro)
  ADD COLUMN IF NOT EXISTS erro_assinatura_anterior text; -- o "antes", para mostrar antes→depois

-- (2) registrar da IA do CHAMADO: guarda também a assinatura de erro.
CREATE OR REPLACE FUNCTION public.fn_sugestao_ia_registrar(p_id uuid, p_analise jsonb, p_custo numeric, p_erro_assinatura text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE sugestoes SET ia_analise = p_analise, ia_analisado_em = now(), ia_custo_usd = COALESCE(p_custo,0),
    erro_assinatura = NULLIF(btrim(COALESCE(p_erro_assinatura,'')),'')
   WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- (3) registrar da IA da MENSAGEM: guarda a assinatura E compara com a anterior (a mais recente do
--     chamado antes desta mensagem — de mensagem anterior OU do próprio chamado). Verdito mecânico.
CREATE OR REPLACE FUNCTION public.fn_sugestao_msg_ia_registrar(p_mensagem_id uuid, p_analise jsonb, p_custo numeric, p_erro_assinatura text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sug uuid; v_criado timestamptz; v_sig text; v_prev text; v_comp text;
BEGIN
  v_sig := NULLIF(btrim(COALESCE(p_erro_assinatura,'')),'');
  SELECT sugestao_id, criado_em INTO v_sug, v_criado FROM sugestao_mensagem WHERE id = p_mensagem_id;
  IF v_sug IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;

  -- assinatura anterior = a mais recente ANTES desta (mensagens anteriores do chamado + a do chamado).
  SELECT sig INTO v_prev FROM (
    SELECT erro_assinatura AS sig, criado_em AS quando FROM sugestao_mensagem
      WHERE sugestao_id = v_sug AND id <> p_mensagem_id AND erro_assinatura IS NOT NULL AND criado_em <= v_criado
    UNION ALL
    SELECT erro_assinatura AS sig, created_at AS quando FROM sugestoes
      WHERE id = v_sug AND erro_assinatura IS NOT NULL
  ) x ORDER BY quando DESC LIMIT 1;

  -- verdito: sem sig atual mas havia anterior → não deu pra comparar; sem anterior → primeiro (NULL);
  --          iguais → mesmo; diferentes → mudou. Comparação case-insensitive/trim.
  v_comp := CASE
    WHEN v_sig IS NULL AND v_prev IS NOT NULL THEN 'sem_comparacao'
    WHEN v_sig IS NULL AND v_prev IS NULL THEN NULL
    WHEN v_prev IS NULL THEN NULL
    WHEN lower(v_sig) = lower(v_prev) THEN 'mesmo'
    ELSE 'mudou' END;

  UPDATE sugestao_mensagem SET
    ia_analise = p_analise, ia_analisado_em = now(), ia_custo_usd = COALESCE(p_custo,0),
    erro_assinatura = v_sig, erro_comparacao = v_comp, erro_assinatura_anterior = v_prev
   WHERE id = p_mensagem_id;

  RETURN jsonb_build_object('ok', true, 'comparacao', v_comp);
END $function$;

-- (4) fn_sugestao_desmembrar: quando o erro mudou, o atendente (PS) desmembra a mensagem num chamado
--     NOVO, vinculado ao original (origem_sugestao_id). Bug diferente = chamado diferente. Sugerido na
--     tela; quem decide é o atendente — NÃO é automático. Copia a foto da mensagem para o novo chamado.
CREATE OR REPLACE FUNCTION public.fn_sugestao_desmembrar(p_mensagem_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  m RECORD; o RECORD; v_novo uuid; v_novo_num int;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT * INTO m FROM sugestao_mensagem WHERE id = p_mensagem_id;
  IF m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  SELECT * INTO o FROM sugestoes WHERE id = m.sugestao_id;

  INSERT INTO sugestoes (user_id, user_email, user_name, tipo, titulo, descricao, prioridade, status,
      company_id, rota, area, categoria, origem_sugestao_id, erro_assinatura)
  VALUES (o.user_id, o.user_email, o.user_name, 'bug',
      'Erro novo (desmembrado do #' || o.numero || ')',
      COALESCE(NULLIF(btrim(m.texto),''), 'Desmembrado do chamado #' || o.numero || ' — erro diferente detectado.'),
      'alta', 'nova', o.company_id, o.rota, o.area, 'bug', o.id, m.erro_assinatura)
  RETURNING id, numero INTO v_novo, v_novo_num;

  -- leva a foto da mensagem para o novo chamado (mesmo arquivo; anexo do chamado, mensagem_id NULL)
  INSERT INTO sugestao_anexo (sugestao_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
  SELECT v_novo, company_id, storage_path, url_publica, tipo, marcacoes, 0, p_user
  FROM sugestao_anexo WHERE mensagem_id = p_mensagem_id;

  -- deixa registrado na conversa do ORIGINAL e avisa o autor
  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto)
  VALUES (o.id, p_user, 'ps', 'Este erro foi desmembrado no chamado #' || v_novo_num || ' para tratar separado — o histórico deste fica limpo.');
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (o.id, o.user_id, 'mensagem',
          '#' || o.numero || ' · Erro novo virou o chamado #' || v_novo_num,
          'O erro que apareceu depois foi separado num chamado próprio para não misturar. Acompanhe pelo #' || v_novo_num || '.');

  RETURN jsonb_build_object('ok', true, 'novo_id', v_novo, 'novo_numero', v_novo_num);
END $function$;

-- (5) fila expõe a assinatura do chamado e o ÚLTIMO verdito de comparação (o PS vê se está patinando).
CREATE OR REPLACE VIEW public.v_sugestao_fila AS
 SELECT s.id, s.company_id, c.nome_fantasia AS empresa, s.user_email, s.user_name, s.tipo,
    s.titulo, s.descricao, s.categoria, s.prioridade, s.status, s.rota, s.area, s.atendente_id,
    s.pr_numero, s.resposta, s.concluido_em,
    (s.ia_analise IS NOT NULL) AS tem_ia, s.ia_analise, s.ia_analisado_em,
    (SELECT count(*) AS count FROM sugestao_anexo a WHERE a.sugestao_id = s.id) AS n_anexos,
    s.created_at,
    ((EXTRACT(epoch FROM (now() - s.created_at)) / 86400::numeric))::integer AS dias_aberta,
    s.resposta_aprovada, s.resposta_aprovada_em, s.confirmado_pelo_autor, s.confirmado_em,
    s.numero,
    s.erro_assinatura, s.origem_sugestao_id,
    (SELECT sm.erro_comparacao FROM sugestao_mensagem sm
       WHERE sm.sugestao_id = s.id AND sm.erro_comparacao IS NOT NULL
       ORDER BY sm.criado_em DESC LIMIT 1) AS ultimo_erro_comparacao
   FROM sugestoes s
     LEFT JOIN companies c ON c.id = s.company_id;
