-- Chamados sem órfão (RD 329fe62e, CEO 09/11). CREATE OR REPLACE de fn_chamados_rotear: corpo igual ao vivo, exceto:
--  1) SENSÍVEIS não são mais pulados: roteados por menor fila, com requer_ok_ceo = true (o Code só executa com OK do CEO).
--     Também marcados em erp_agente_mensagem.sensivel = true. Não depende de o dev pôr label.
--  2) status 'aguardando_confirmacao' entra no roteamento (acompanhamento).
--  3) SINCRONIZAÇÃO: chamado ABERTO com tarefa de dev em caixa e agente vazio recebe o agente do destinatário.
-- Sem cron novo e sem alterar frequência. Hub continua no fn_hub_rotear_gaps. Sem execução no merge.
-- Aditiva: 1 coluna nova com default (sensivel). Ordenação da caixa (novos no topo) NÃO muda aqui (fn_agente_caixa).

ALTER TABLE public.erp_agente_mensagem ADD COLUMN IF NOT EXISTS sensivel boolean NOT NULL DEFAULT false;

-- Dev de menor fila: ATIVO = executou nas últimas 2 h (erp_code_execucao_log). A flag pausado está desatualizada e não é usada.
-- Usada só por fn_chamados_rotear.
CREATE OR REPLACE FUNCTION public.fn_dev_mais_vazio()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.agente
    FROM public.erp_agente_papel p
   WHERE p.papel = 'dev_hub'
     AND p.agente <> 'gilberto-desenv'
     AND EXISTS (SELECT 1 FROM public.erp_code_execucao_log l
                  WHERE l.agente = p.agente AND l.iniciada_em > now() - interval '2 hours')
     AND (SELECT count(*) FROM public.erp_agente_mensagem m
           WHERE m.para = p.agente AND m.assunto LIKE 'CHAMADO #%'
             AND m.status IN ('nova', 'recebida', 'em_andamento')
             AND coalesce(m.arquivada, false) = false) < 10
   ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
              WHERE m.para = p.agente AND m.status IN ('nova', 'recebida', 'em_andamento')
                AND coalesce(m.arquivada, false) = false) ASC,
            p.agente ASC
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_dev_mais_vazio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_mais_vazio() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_chamados_rotear(p_limite integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c record; m record; v_dev text; v_res jsonb; v_msg uuid;
  v_rot int := 0; v_sens int := 0; v_dev_n int := 0; v_sem int := 0; v_sync int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fn_chamados_rotear é só do cron/serviço' USING ERRCODE = '42501';
  END IF;

  -- Sincronização A: chamado de sócio (escopo) com agente vazio recebe o dono do escopo (fn_chamado_agente_dono).
  -- Não muda o roteamento: o dono de sócio já é excluído do roteador.
  WITH sync_a AS (
    UPDATE public.sugestoes s
       SET agente = d.dono, ultimo_movimento = now()
      FROM (
        SELECT x.id, public.fn_chamado_agente_dono(x.id) AS dono
          FROM public.sugestoes x
         WHERE (x.agente IS NULL OR x.agente = '')
           AND x.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
      ) d
     WHERE s.id = d.id AND d.dono IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_sync FROM sync_a;

  -- Sincronização B: chamado aberto com tarefa de dev em caixa (por id OU por número) e agente vazio recebe o destinatário.
  WITH sync_b AS (
    UPDATE public.sugestoes s
       SET agente = t.para, em_atendimento_desde = coalesce(s.em_atendimento_desde, now()), ultimo_movimento = now()
      FROM (
        SELECT DISTINCT ON (s2.id) s2.id, x.para
          FROM public.sugestoes s2
          JOIN public.erp_agente_mensagem x
            ON (x.sugestao_id = s2.id OR x.chamado_numero = s2.numero)
         WHERE x.status IN ('nova', 'recebida', 'em_andamento')
           AND coalesce(x.arquivada, false) = false
           AND x.para IN (SELECT p.agente FROM public.erp_agente_papel p WHERE p.papel = 'dev_hub')
           AND (s2.agente IS NULL OR s2.agente = '')
           AND s2.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
         ORDER BY s2.id, x.criado_em DESC
      ) t
     WHERE s.id = t.id
    RETURNING 1
  )
  SELECT v_sync + count(*) INTO v_sync FROM sync_b;

  -- Devolução: tarefa de chamado aberta há > 24 h em dev pausado/fora do papel ou sem atividade em 2 h volta ao grupo.
  -- Identificada pela coluna sugestao_id (robusto a qualquer título), não pelo padrão 'CHAMADO #%'.
  FOR m IN
    SELECT x.id, x.sugestao_id, x.assunto
      FROM public.erp_agente_mensagem x
     WHERE x.sugestao_id IS NOT NULL
       AND x.status IN ('nova', 'recebida', 'em_andamento')
       AND coalesce(x.arquivada, false) = false
       AND x.criado_em < now() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM public.erp_agente_papel p
          WHERE p.agente = x.para AND p.papel = 'dev_hub' AND NOT p.pausado
            AND (
              EXISTS (SELECT 1 FROM public.erp_dev_entrega e WHERE e.code = p.agente AND e.ocorrido_em > now() - interval '2 hours')
              OR EXISTS (SELECT 1 FROM public.erp_agente_mensagem y
                          WHERE y.para = p.agente AND y.id <> x.id
                            AND greatest(y.recebida_em, y.iniciada_em, y.concluida_em) > now() - interval '2 hours')
              OR EXISTS (SELECT 1 FROM public.erp_agente_sessao_lease l
                          WHERE l.agente = p.agente AND l.renovada_em > now() - interval '2 hours'
                            AND l.renovada_em >= l.iniciada_em)
              OR greatest(x.recebida_em, x.iniciada_em, x.atualizado_em) > now() - interval '2 hours'
            )
       )
  LOOP
    PERFORM public.fn_agente_mensagem_arquivar(m.id);
    IF m.sugestao_id IS NOT NULL THEN
      UPDATE public.sugestoes SET agente = NULL, em_atendimento_desde = NULL WHERE id = m.sugestao_id;
    END IF;
    v_dev_n := v_dev_n + 1;
  END LOOP;

  -- Candidatos: todo chamado ABERTO (por STATUS) sem dono, roteado por menor fila.
  -- Sensíveis são roteados como os demais, mas a tarefa vai marcada (sensivel = true) e o PR pede aprovação.
  FOR c IN
    SELECT s.id, s.numero, s.titulo, s.descricao, s.area, s.categoria, s.rota, s.prioridade,
           EXISTS (SELECT 1 FROM public.erp_chamado_regra_sensivel r
                    WHERE r.ativo
                      AND (s.titulo ILIKE '%' || r.padrao || '%' OR s.descricao ILIKE '%' || r.padrao || '%'
                           OR s.area ILIKE '%' || r.padrao || '%' OR s.categoria ILIKE '%' || r.padrao || '%')) AS sensivel
      FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
       AND coalesce(s.interno, false) = false
       AND s.numero IS NOT NULL
       AND public.fn_chamado_agente_dono(s.id) IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_agente_mensagem t
                        WHERE (t.sugestao_id = s.id OR t.chamado_numero = s.numero)
                          AND t.status IN ('nova', 'recebida', 'em_andamento')
                          AND coalesce(t.arquivada, false) = false)
       AND ( (s.agente IS NULL AND s.responsavel_id IS NULL)
          OR (s.agente IS NOT NULL
              AND s.agente NOT IN (SELECT p.agente FROM public.erp_agente_papel p WHERE p.papel = 'dev_hub' AND NOT p.pausado)
              AND s.agente NOT IN (SELECT d.agente FROM public.erp_agente_dono d WHERE d.ativo))
          OR s.responsavel_id IS NOT NULL )
       AND NOT (s.area = 'hub_projetos' AND EXISTS (
              SELECT 1 FROM public.hub_tela_dono h WHERE s.rota LIKE h.rota_prefixo || '%'))
     ORDER BY s.created_at
     LIMIT 200
  LOOP
    EXIT WHEN v_rot >= p_limite;
    IF c.sensivel THEN
      v_sens := v_sens + 1;
    END IF;

    v_dev := public.fn_dev_mais_vazio();
    IF v_dev IS NULL THEN
      v_sem := v_sem + 1;
      EXIT;
    END IF;

    v_res := public.fn_agente_mensagem_enviar(
      v_dev, 'eng_chefe', 'tarefa',
      'CHAMADO #' || c.numero || ' · ' || coalesce(c.area, 'sem área'),
      'Chamado aberto que ninguém trabalha (roteador, decisão do CEO 28/10).' || E'\n'
      || 'Chamado: #' || c.numero || ' (id ' || c.id || ')' || E'\n'
      || 'Rota: ' || coalesce(c.rota, '—') || E'\n'
      || 'Área: ' || coalesce(c.area, '—') || ' · Prioridade: ' || coalesce(c.prioridade::text, '—') || E'\n'
      || CASE WHEN c.sensivel
              THEN 'SENSÍVEL: qualquer PR deste chamado leva a label revisao-eng-chefe e NÃO publica sem aprovação do CEO/sócio.' || E'\n'
              ELSE '' END
      || '(LGPD: título e descrição do cliente NÃO são copiados para a fila; leia pelo id em sugestoes.)' || E'\n\n'
      || 'Regras: PR pequena, com "Code: ' || v_dev || '" no corpo. A resposta ao cliente só sai por '
      || 'fn_agente_chamado_responder, com OK do CEO. Não conclua esta tarefa antes de resolver o chamado.',
      c.sensivel, 'eng_chefe');  -- sensível: requer_ok_ceo=true (o Code só executa com OK do CEO; o PR não publica sem ele)

    v_msg := (v_res ->> 'id')::uuid;
    UPDATE public.erp_agente_mensagem SET sugestao_id = c.id, chamado_numero = c.numero, sensivel = c.sensivel WHERE id = v_msg;
    UPDATE public.sugestoes SET agente = v_dev, em_atendimento_desde = now(), ultimo_movimento = now() WHERE id = c.id;
    v_rot := v_rot + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'roteados', v_rot, 'sensiveis_roteados', v_sens, 'devolvidos', v_dev_n,
                            'sincronizados', v_sync, 'sem_dev_vivo', v_sem, 'em', now());
END;
$function$;

-- Função de serviço (cron): não executável por anon/authenticated. Escrita de sistema, sem parâmetro de cliente.
-- ci-sem-guarda: fn_chamados_rotear — roteamento de sistema (cron/serviço); o auth.uid() IS NOT NULL recusa chamada de usuário.
REVOKE ALL ON FUNCTION public.fn_chamados_rotear(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamados_rotear(integer) TO service_role;
