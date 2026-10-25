-- PDCA do Hub: rodízio honesto do disparo do auditor (gilberto-desenv 25/10, RD-38 provado no dado).
--
-- Bug: o passo 2 do fn_pdca_hub_tick escolhia as rotas pela system_screens.ultima_validacao_visual_em, que o
-- disparo NUNCA atualiza. Resultado: a cada hora as MESMAS 6 rotas mais antigas eram fotografadas
-- (catalogo, cronograma, clientes, visitas, viagens, calculadora — 7 a 21 análises/24 h cada) e o resto do Hub
-- ficou sem print novo desde 17–19/10 (/dashboard/projetos, obras, propostas, engenharia, obras/resultado,
-- instalar-app...). As correções publicadas nessas telas nunca eram reauditadas e as tarefas "PDCA Hub ·" não fechavam.
--
-- Correção: a "última vez" de cada rota é o MAIOR entre ultima_validacao_visual_em e o último print/análise do
-- auditor em system_screens_insights da mesma rota; o disparo pega as mais antigas por esse critério (rodízio real).
-- Corpo restante IDÊNTICO à definição viva (pg_get_functiondef 25/10): guarda, promoção só com LIBERADO,
-- roteamento por dono, disparo só pela fn_auditor_disparar (DEMO). Nenhuma tabela ou dado de cliente tocado.

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
      v_owner := CASE
        WHEN r.rota = '/dashboard/projetos'
             OR r.rota ~ '(cronograma|/configuracoes|instalar-app|/campo)' THEN 'gilberto-desenv'
        WHEN r.rota ~ '(catalogo|insumos|mao-obra|calculadora|propostas|simulador|tabelas-preco|takeoff|engenharia)' THEN 'code-desenvolvedor-3'
        WHEN r.rota ~ '(obras|cockpit|resultado|acompanhamento|desempenho|visitas|clientes|oportunidades|viagens)' THEN 'gilberto-esteira'
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

  -- Rodízio: "última vez" = maior entre a validação visual e o último print/análise do auditor desta rota.
  FOR r IN
    SELECT s.rota FROM system_screens s
      LEFT JOIN LATERAL (
        SELECT max(coalesce(i.screenshot_capturado_em, i.analisado_em)) AS ultimo_print
          FROM system_screens_insights i WHERE i.rota = s.rota
      ) u ON true
     WHERE s.rota LIKE '/dashboard/projetos%' AND coalesce(s.auditavel_robo, true) = true
       AND (greatest(s.ultima_validacao_visual_em, u.ultimo_print) IS NULL
            OR greatest(s.ultima_validacao_visual_em, u.ultimo_print) < now() - interval '6 hours')
     ORDER BY greatest(s.ultima_validacao_visual_em, u.ultimo_print) NULLS FIRST LIMIT p_dispatch_limit
  LOOP
    PERFORM public.fn_auditor_disparar(r.rota);
    v_disp := v_disp + 1;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'promovidas',v_prom,'roteadas',v_rot,'disparadas',v_disp,'em',now());
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pdca_hub_tick(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pdca_hub_tick(integer, integer) TO authenticated, service_role;
