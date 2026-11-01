-- Roteador de chamados: chamado aberto que ninguém trabalha vai, de hora em hora, para o dev vivo mais vazio.
-- ADITIVA: 1 tabela nova (regras de sensibilidade), 2 funções novas, 1 job. Não altera fn_pdca_dono_hub.
-- Code: dev7claudeps

-- 1) Padrões de chamado sensível (nunca roteado automaticamente: segue o fluxo humano / OK do CEO).
CREATE TABLE IF NOT EXISTS public.erp_chamado_regra_sensivel (
  padrao    text PRIMARY KEY,
  motivo    text,
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_chamado_regra_sensivel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_chamado_regra_sensivel FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_chamado_regra_sensivel TO service_role;
COMMENT ON TABLE public.erp_chamado_regra_sensivel IS 'Chamados: padrões (ILIKE %padrao%) que tiram o chamado do roteador automático. Só service_role.';

INSERT INTO public.erp_chamado_regra_sensivel (padrao, motivo) VALUES
  ('fiscal','fiscal'), ('nf-e','fiscal'), ('nfe','fiscal'), ('nfs-e','fiscal'), ('nfse','fiscal'), ('nfc-e','fiscal'),
  ('financeiro','financeiro de cliente'), ('conciliaç','financeiro de cliente'), ('saldo','financeiro de cliente'),
  ('boleto','financeiro de cliente'), ('cobran','financeiro de cliente'), ('remessa','financeiro de cliente'),
  ('retorno','financeiro de cliente'), ('pagamento','financeiro de cliente'),
  ('permiss','permissão/RLS'), ('rls','permissão/RLS'), ('acesso','permissão/RLS'), ('senha','permissão/RLS'),
  ('lgpd','LGPD'), ('wealth','Wealth/CVM'), ('cvm','Wealth/CVM'),
  ('nr-36','NR-36'), ('nr36','NR-36'), ('pausa térmica','NR-36'), ('pausas térmicas','NR-36'),
  ('salário','LGPD/salários'), ('folha','LGPD/salários'), ('omie','integração Omie'), ('cadastro','núcleo: cadastros')
ON CONFLICT (padrao) DO NOTHING;

-- 2) Dev vivo mais vazio: mesmo critério de "vivo" de fn_pdca_dono_hub, mas ordena pelo total ABERTO
--    e ignora quem já tem >= 10 tarefas de chamado abertas.
-- ci-sem-guarda: fn_dev_mais_vazio — só leitura da fila interna de agentes (erp_agente_*), sem dado de empresa de cliente; EXECUTE só service_role.
CREATE OR REPLACE FUNCTION public.fn_dev_mais_vazio()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT p.agente
    FROM public.erp_agente_papel p
   WHERE p.papel = 'dev_hub'
     AND NOT p.pausado
     AND (
       EXISTS (SELECT 1 FROM public.erp_dev_entrega e
                WHERE e.code = p.agente AND e.ocorrido_em > now() - interval '2 hours')
       OR EXISTS (SELECT 1 FROM public.erp_agente_mensagem m
                   WHERE m.para = p.agente
                     AND greatest(m.recebida_em, m.iniciada_em, m.concluida_em) > now() - interval '2 hours')
       OR EXISTS (SELECT 1 FROM public.erp_agente_sessao_lease l
                   WHERE l.agente = p.agente
                     AND l.renovada_em > now() - interval '2 hours'
                     AND l.renovada_em >= l.iniciada_em)
     )
     AND (SELECT count(*) FROM public.erp_agente_mensagem m
           WHERE m.para = p.agente AND m.assunto LIKE 'CHAMADO #%'
             AND m.status IN ('nova', 'recebida', 'em_andamento')
             AND coalesce(m.arquivada, false) = false) < 10
   ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
              WHERE m.para = p.agente AND m.status IN ('nova', 'recebida', 'em_andamento')
                AND coalesce(m.arquivada, false) = false) ASC,
            p.agente ASC
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.fn_dev_mais_vazio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_mais_vazio() TO service_role;

-- 3) O roteador. Roda como cron/serviço (auth.uid() nulo); usuário logado é recusado.
--    A devolução é SOFT: a tarefa do dev parado é ARQUIVADA (não apagada) e o chamado continua ABERTO (status intacto),
--    só volta ao grupo (agente = NULL). Tarefa de dev vivo e recente nunca é arquivada.
-- ci-sem-guarda: fn_chamados_rotear — só cron/serviço (recusa auth.uid() não nulo, EXECUTE só service_role); grava fila interna de agentes (erp_agente_mensagem) e só marca sugestoes.agente/em_atendimento_desde/ultimo_movimento; não altera texto, status nem dado de empresa de cliente.
CREATE OR REPLACE FUNCTION public.fn_chamados_rotear(p_limite integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c record; m record; v_dev text; v_res jsonb; v_msg uuid;
  v_rot int := 0; v_sens int := 0; v_dev_n int := 0; v_sem int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fn_chamados_rotear é só do cron/serviço' USING ERRCODE = '42501';
  END IF;

  -- Devolução: tarefa de chamado aberta há > 24 h em dev pausado/fora do papel ou sem atividade em 2 h volta ao grupo.
  FOR m IN
    SELECT x.id, x.sugestao_id, x.assunto
      FROM public.erp_agente_mensagem x
     WHERE x.assunto LIKE 'CHAMADO #%'
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

  -- Candidatos (sensíveis são contados e pulados; o limite vale só para os efetivamente roteados).
  FOR c IN
    SELECT s.id, s.numero, s.titulo, s.descricao, s.area, s.categoria, s.rota, s.prioridade,
           EXISTS (SELECT 1 FROM public.erp_chamado_regra_sensivel r
                    WHERE r.ativo
                      AND (s.titulo ILIKE '%' || r.padrao || '%' OR s.descricao ILIKE '%' || r.padrao || '%'
                           OR s.area ILIKE '%' || r.padrao || '%' OR s.categoria ILIKE '%' || r.padrao || '%')) AS sensivel
      FROM public.sugestoes s
     WHERE s.status IN ('nova', 'em_analise')
       AND coalesce(s.interno, false) = false
       AND s.numero IS NOT NULL
       AND public.fn_chamado_agente_dono(s.id) IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_agente_mensagem t
                        WHERE t.assunto LIKE 'CHAMADO #' || s.numero || ' %'
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
    IF c.sensivel THEN
      v_sens := v_sens + 1;
      CONTINUE;
    END IF;
    EXIT WHEN v_rot >= p_limite;

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
      || '(LGPD: título e descrição do cliente NÃO são copiados para a fila; leia pelo id em sugestoes.)' || E'\n\n'
      || 'Regras: PR pequena, com "Code: ' || v_dev || '" no corpo. A resposta ao cliente só sai por '
      || 'fn_agente_chamado_responder, com OK do CEO. Não conclua esta tarefa antes de resolver o chamado.',
      false, 'eng_chefe');

    v_msg := (v_res ->> 'id')::uuid;
    UPDATE public.erp_agente_mensagem SET sugestao_id = c.id, chamado_numero = c.numero WHERE id = v_msg;
    UPDATE public.sugestoes SET agente = v_dev, em_atendimento_desde = now(), ultimo_movimento = now() WHERE id = c.id;
    v_rot := v_rot + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'roteados', v_rot, 'sensiveis', v_sens, 'devolvidos', v_dev_n,
                            'sem_dev_vivo', v_sem, 'em', now());
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_chamados_rotear(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamados_rotear(integer) TO service_role;

-- 4) De hora em hora (idempotente: cron.schedule faz upsert pelo nome do job).
SELECT cron.schedule('chamados-rotear-hora', '5 * * * *', $cron$SELECT public.fn_chamados_rotear(10);$cron$);
