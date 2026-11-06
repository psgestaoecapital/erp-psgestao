-- PDCA do Hub (Eng. Chefe 23/10, msg 6fd7cc9d item 2): formaliza em migration (RD-52, durabilidade)
-- a fn_pdca_hub_tick e o agendamento 'pdca-hub-tick-hora', que existiam só por hotfix no banco.
-- Corpo IDÊNTICO à definição viva (pg_get_functiondef em 23/10 22:15 UTC): não muda comportamento,
-- só garante que sobrevive a rebuild do schema. Aditiva: nenhuma tabela ou dado de cliente tocado.
--
-- O tick (de hora em hora):
--   1) para cada rota do Hub analisada nas últimas 24 h, pede o veredito a fn_auditor_tela_completo;
--      LIBERADO → system_screens.estado_real='pronto' (promoção honesta); BLOQUEADO → tarefa
--      "PDCA Hub · <rota>" ao Code dono da faixa (uma aberta por rota, sem repetir);
--   2) dispara o auditor (fn_auditor_disparar, só DEMO) nas rotas do Hub sem validação visual há 6 h.

CREATE OR REPLACE FUNCTION public.fn_pdca_hub_tick(p_dispatch_limit integer DEFAULT 6, p_route_limit integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_disp int:=0; v_rot int:=0; v_prom int:=0; v_res jsonb; v_owner text; v_gaps text; v_vd text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissão para fn_pdca_hub_tick' USING ERRCODE='42501';
  END IF;

  FOR r IN
    SELECT DISTINCT i.rota FROM system_screens_insights i
     WHERE i.rota LIKE '/dashboard/projetos%' AND i.analisado_em > now() - interval '24 hours'
  LOOP
    v_res := public.fn_auditor_tela_completo(r.rota);
    v_vd := v_res->>'veredito';
    IF v_vd = 'LIBERADO' THEN
      UPDATE system_screens SET estado_real='pronto', atualizado_em=now()
       WHERE rota=r.rota AND estado_real NOT IN ('pronto','previsto');
      IF FOUND THEN v_prom := v_prom + 1; END IF;
    ELSIF v_vd = 'BLOQUEADO' AND v_rot < p_route_limit THEN
      -- Faixa por dono (divisão completa das 28 telas; desenv tem o especial antes do "obras" do esteira).
      v_owner := CASE
        WHEN r.rota = '/dashboard/projetos'
             OR r.rota ~ '(cronograma|/configuracoes|instalar-app)' THEN 'gilberto-desenv'
        WHEN r.rota ~ '(catalogo|insumos|mao-obra|calculadora|propostas|simulador|tabelas-preco|takeoff|engenharia)' THEN 'code-desenvolvedor-3'
        WHEN r.rota ~ '(obras|cockpit|resultado|acompanhamento|desempenho|visitas|clientes|oportunidades)' THEN 'gilberto-esteira'
        ELSE 'gilberto-desenv' END;
      IF NOT EXISTS (
        SELECT 1 FROM erp_agente_mensagem m
         WHERE m.para=v_owner AND m.status IN ('nova','em_andamento','recebida')
           AND coalesce(m.arquivada,false)=false AND m.assunto LIKE 'PDCA Hub · '||r.rota||'%'
      ) THEN
        v_gaps := array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_res->'gaps')), E'\n- ');
        PERFORM public.fn_agente_mensagem_enviar(
          v_owner,'eng_chefe','tarefa',
          'PDCA Hub · '||r.rota||' · BLOQUEADO (auditor)',
          'O auditor reprovou esta tela na DEMO. Só LIBERA a 100% (tela, funções, funcionalidades, CÁLCULO correto via GE integrado). Corrija e leve a Gold.'
            ||E'\nTela: '||r.rota||E'\nScores: '||coalesce((v_res->'scores')::text,'{}')
            ||E'\nGaps:\n- '||coalesce(v_gaps,'(ver system_screens_insights)')
            ||E'\nNUNCA conclua até LIBERADO.',
          false,'eng_chefe');
        v_rot := v_rot + 1;
      END IF;
    END IF;
  END LOOP;

  FOR r IN
    SELECT s.rota FROM system_screens s
     WHERE s.rota LIKE '/dashboard/projetos%' AND coalesce(s.auditavel_robo, true) = true
       AND (s.ultima_validacao_visual_em IS NULL OR s.ultima_validacao_visual_em < now() - interval '6 hours')
     ORDER BY s.ultima_validacao_visual_em NULLS FIRST LIMIT p_dispatch_limit
  LOOP
    PERFORM public.fn_auditor_disparar(r.rota);
    v_disp := v_disp + 1;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'promovidas',v_prom,'roteadas',v_rot,'disparadas',v_disp,'em',now());
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pdca_hub_tick(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pdca_hub_tick(integer, integer) TO authenticated, service_role;

-- De hora em hora, no minuto 0 (o mesmo do job vivo 94). Idempotente: cron.schedule faz upsert pelo nome do job.
SELECT cron.schedule('pdca-hub-tick-hora', '0 * * * *', $cron$SELECT public.fn_pdca_hub_tick();$cron$);
