-- Codes: roteamento do PDCA só para os devs vivos + redistribuição das telas dos Codes inativos (sessao-manual 27/10).
--
-- 1) fn_pdca_hub_tick: o auditor manda tarefa "PDCA Hub · BLOQUEADO" SÓ para dev7claudeps ou desenvolvedor_4_g.
--    A faixa é a do CEO: dev7claudeps = obras, cockpit, takeoff, engenharia, simulador, propostas, acompanhamento,
--    desempenho, projetos (raiz), catalogo; desenvolvedor_4_g = viagens, calculadora, clientes, oportunidades, visitas,
--    insumos, mao-obra, tabelas-preco, configuracoes, frota, instalar-app. Rota fora das faixas (cronograma, /campo)
--    vai para dev7claudeps. Guarda: qualquer dono calculado fora dos dois vira dev7claudeps (nunca um inativo).
--    Corpo IDÊNTICO à definição viva (pg_get_functiondef 27/10) exceto o mapa de donos e a guarda.
--    Nenhuma função de guarda (RD-91) é alterada.
-- 2) As tarefas de TELA ainda 'nova' e não arquivadas que estavam nos Codes inativos vão para os devs vivos.
--    Só troca 'para' de linhas exatas (id) que ainda estão 'nova', não arquivadas e num inativo. Nada é apagado.
-- 3) As tarefas "AUTO: drenagem / EMERGENCIA" dos inativos já estavam arquivadas (arquivada = true); não há o que mudar.

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
      -- dono só entre os dois devs vivos (faixa do CEO 27/10); o resto, e qualquer rota fora da faixa, vai para dev7claudeps
      v_owner := CASE
        WHEN r.rota ~ '(viagens|calculadora|clientes|oportunidades|visitas|insumos|mao-obra|tabelas-preco|configuracoes|frota|instalar-app)'
          THEN 'desenvolvedor_4_g'
        ELSE 'dev7claudeps' END;
      IF v_owner NOT IN ('dev7claudeps', 'desenvolvedor_4_g') THEN
        v_owner := 'dev7claudeps';
      END IF;
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

-- 2) redistribuição das telas dos inativos (só as 9 linhas abertas, por id, ainda nos inativos)
UPDATE public.erp_agente_mensagem m SET para = v.para_novo
  FROM (VALUES
    ('fa9c1341-5608-4752-8c89-4d8a393f808a'::uuid, 'dev7claudeps'),     -- engenharia (BLOQUEADO)
    ('58ae38dc-7f4a-4594-a755-0f9ca7bdd3ad'::uuid, 'dev7claudeps'),     -- /projetos (BLOQUEADO)
    ('62ee0657-7e8c-4e07-b10d-0e05640c3837'::uuid, 'dev7claudeps'),     -- catalogo (GAPS)
    ('8d178833-332a-4d92-9691-c5908dfb96cc'::uuid, 'dev7claudeps'),     -- catalogo/[id] (BLOQUEADO)
    ('3c0a67a0-41cb-43cd-9a35-809d328fcce6'::uuid, 'dev7claudeps'),     -- catalogo (BLOQUEADO)
    ('53bd3831-26f1-4aaf-b700-229f528f6382'::uuid, 'desenvolvedor_4_g'), -- instalar-app (BLOQUEADO)
    ('f4f7ba2f-7603-4a60-8088-5f4157ef7b77'::uuid, 'desenvolvedor_4_g'), -- configuracoes (BLOQUEADO)
    ('a7add285-c9a9-40e1-ab2b-6f0deb83bcc4'::uuid, 'desenvolvedor_4_g'), -- calculadora (BLOQUEADO)
    ('5525ee14-ea1a-4514-b9c5-93ece53c8e9a'::uuid, 'desenvolvedor_4_g')  -- calculadora (GAPS)
  ) AS v(id, para_novo)
 WHERE m.id = v.id
   AND m.status = 'nova'
   AND coalesce(m.arquivada, false) = false
   AND m.para IN ('gilberto-desenv', 'code-desenvolvedor-3');

REVOKE ALL ON FUNCTION public.fn_pdca_hub_tick(integer, integer) FROM PUBLIC, anon;
