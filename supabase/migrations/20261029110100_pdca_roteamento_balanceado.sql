-- PDCA: roteamento BALANCEADO por dev vivo + menor fila (sessao-manual 27/10). Sem faixa fixa por nome.
--
-- Problema: o fn_pdca_hub_tick roteava por faixa com nomes cravados. Quando um dev era pausado, as tarefas da faixa
-- dele encalhavam. Agora o dono é escolhido na hora:
--   1) devs ELEGÍVEIS = papel 'dev_hub' em erp_agente_papel, não pausado, com sessão viva (lease renovada há menos de
--      2 h e não encerrada: renovada_em >= iniciada_em; fn_agente_sessao_encerrar grava renovada_em = now() - 1 dia).
--   2) 0 elegíveis → não cria tarefa (o PDCA conta em "sem_dev_vivo"). Nunca manda para Code sem sessão.
--   3) 1 elegível → manda para ele.
--   4) 2+ elegíveis → manda para o de MENOR fila (tarefas 'nova' não arquivadas na caixa). Empate: pelo nome.
--   Dedupe: não cria 'PDCA Hub · <rota>' se já há uma aberta para QUALQUER dev_hub (troca de dono entre ticks não duplica).
--
-- "Pausado" é a coluna erp_agente_papel.pausado (o CEO liga/desliga). NÃO usa erp_agente_rotina.aciona, que hoje é false
-- também para devs com sessão viva (ver nota no PR).
--
-- Semente: dev7claudeps e desenvolvedor_4_g (papel dev_hub), editável pelo CEO. A lógica não depende dos nomes.
-- Nenhuma função de guarda (RD-91) é alterada. Nada é apagado.

-- 1) papel dos Codes (editável; sem policy de leitura para anon/authenticated)
CREATE TABLE IF NOT EXISTS public.erp_agente_papel (
  agente     text PRIMARY KEY REFERENCES public.erp_agente_rotina(agente),
  papel      text NOT NULL CHECK (papel IN ('dev_hub', 'auditor', 'esteira', 'revisor', 'socio', 'outro')),
  pausado    boolean NOT NULL DEFAULT false,
  observacao text,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_agente_papel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_agente_papel FROM PUBLIC, anon, authenticated;

INSERT INTO public.erp_agente_papel (agente, papel, observacao) VALUES
  ('dev7claudeps',     'dev_hub', 'Dev do Hub (semente 27/10; editável)'),
  ('desenvolvedor_4_g', 'dev_hub', 'Dev do Hub (semente 27/10; editável)')
ON CONFLICT (agente) DO NOTHING;

-- 2) escolha do dono: vivo + menor fila. Devolve NULL quando não há dev vivo.
CREATE OR REPLACE FUNCTION public.fn_pdca_dono_hub()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.agente
    FROM public.erp_agente_papel p
    JOIN public.erp_agente_sessao_lease l ON l.agente = p.agente
   WHERE p.papel = 'dev_hub'
     AND NOT p.pausado
     AND l.renovada_em > now() - interval '2 hours'
     AND l.renovada_em >= l.iniciada_em
   ORDER BY (SELECT count(*) FROM public.erp_agente_mensagem m
              WHERE m.para = p.agente AND m.status = 'nova' AND coalesce(m.arquivada, false) = false) ASC,
            p.agente ASC
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.fn_pdca_dono_hub() FROM PUBLIC, anon, authenticated;

-- 3) fn_pdca_hub_tick: mesmo corpo da versão de main (20261029100100), trocando só o dono e a dedupe.
CREATE OR REPLACE FUNCTION public.fn_pdca_hub_tick(p_dispatch_limit integer DEFAULT 6, p_route_limit integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_disp int:=0; v_rot int:=0; v_prom int:=0; v_sem int:=0; v_res jsonb; v_owner text; v_gaps text; v_vd text;
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
      -- dono = dev vivo de menor fila (fn_pdca_dono_hub). Sem dev vivo: não cria tarefa.
      v_owner := public.fn_pdca_dono_hub();
      IF v_owner IS NULL THEN
        v_sem := v_sem + 1;
      ELSIF NOT EXISTS (
        SELECT 1 FROM erp_agente_mensagem m
         WHERE m.para IN (SELECT agente FROM erp_agente_papel WHERE papel = 'dev_hub')
           AND m.status IN ('nova','em_andamento','recebida')
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

  RETURN jsonb_build_object('ok',true,'promovidas',v_prom,'roteadas',v_rot,'sem_dev_vivo',v_sem,'disparadas',v_disp,'em',now());
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pdca_hub_tick(integer, integer) FROM PUBLIC, anon;
