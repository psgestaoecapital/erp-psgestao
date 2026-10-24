-- Hub · o ciclo auditar → rotear o gap → corrigir → reauditar roda sozinho no banco (CEO 24/10: "esse é o padrão da nossa infra").
-- O auditor grava cada requisito em blueprint_tela_cobertura (ausente/quebrado/parcial). Esta função lê o último
-- estado de cada requisito da tela, e quando o CONJUNTO de gaps mudou manda UMA tarefa ao Code dono da tela
-- (fn_agente_mensagem_enviar, de=eng_chefe, mesmo canal do fn_pdca_hub_tick). Não repete enquanto houver tarefa aberta
-- nem enquanto o conjunto de gaps for o mesmo. Só ADITIVO: tabelas e função novas, nada existente é alterado.

-- 1) Quem é o dono de cada tela do Hub (prefixo de rota). Edita-se por INSERT/UPDATE quando a divisão muda.
CREATE TABLE IF NOT EXISTS public.hub_tela_dono (
  rota_prefixo  text PRIMARY KEY CHECK (rota_prefixo LIKE '/dashboard/%'),
  code          text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hub_tela_dono ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hub_tela_dono FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.hub_tela_dono TO service_role;
COMMENT ON TABLE public.hub_tela_dono IS 'Hub: Code dono de cada tela (prefixo de rota). Lida por fn_hub_rotear_gaps. Só service_role.';

INSERT INTO public.hub_tela_dono (rota_prefixo, code) VALUES
  ('/dashboard/projetos/tabelas-preco', 'desenvolvedor_6_g'),
  ('/dashboard/projetos/viagens',       'desenvolvedor_4_g'),
  ('/dashboard/projetos/calculadora',   'code-desenvolvedor-3'),
  ('/dashboard/projetos/catalogo',      'code-desenvolvedor-3'),
  ('/dashboard/projetos/insumos',       'code-desenvolvedor-3'),
  ('/dashboard/projetos/mao-obra',      'code-desenvolvedor-3')
ON CONFLICT (rota_prefixo) DO NOTHING;

-- 2) Memória do que já foi roteado (conjunto de gaps → não manda a mesma tarefa de novo).
CREATE TABLE IF NOT EXISTS public.hub_gap_roteado (
  rota         text PRIMARY KEY,
  code         text NOT NULL,
  hash_gaps    text NOT NULL,
  n_gaps       integer NOT NULL,
  enviado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hub_gap_roteado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hub_gap_roteado FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.hub_gap_roteado TO service_role;
COMMENT ON TABLE public.hub_gap_roteado IS 'Hub: último conjunto de gaps roteado por tela (evita tarefa repetida). Só service_role.';

-- 3) O roteador. Roda como cron/serviço (auth.uid() nulo); usuário logado é recusado.
-- ci-sem-guarda: fn_hub_rotear_gaps — só cron/serviço (recusa auth.uid() não nulo, EXECUTE só service_role) e grava só fila interna de agentes (hub_gap_roteado, erp_agente_mensagem), nenhum registro de empresa de cliente.
CREATE OR REPLACE FUNCTION public.fn_hub_rotear_gaps(p_limite integer DEFAULT 4)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  d record; v_rotas int := 0; v_pulou int := 0; v_hash text; v_n int := 0; v_lista text; v_assunto text;
  v_detalhe jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fn_hub_rotear_gaps é só do cron/serviço' USING ERRCODE = '42501';
  END IF;

  FOR d IN SELECT rota_prefixo, code FROM hub_tela_dono ORDER BY rota_prefixo LOOP
    EXIT WHEN v_rotas >= p_limite;

    -- último estado de cada requisito da tela (cobertura mais recente, senão a linha-de-base); hash do conjunto COMPLETO
    SELECT coalesce(md5(string_agg(id::text || ':' || st, ',' ORDER BY id::text)), ''), count(*)
      INTO v_hash, v_n
      FROM (
        SELECT r.id,
               coalesce((SELECT c.status FROM blueprint_tela_cobertura c WHERE c.requisito_id = r.id
                          ORDER BY c.avaliado_em DESC LIMIT 1), r.status_baseline) AS st
          FROM blueprint_tela_requisito r
         WHERE r.rota_padrao = d.rota_prefixo AND r.tipo IS DISTINCT FROM 'nao_construir'
      ) z
     WHERE st IN ('quebrado', 'ausente', 'parcial');

    CONTINUE WHEN v_n = 0;                                   -- nada a rotear
    v_assunto := 'GAPS Hub · ' || d.rota_prefixo || ' · ' || v_n || ' pendentes (auditor)';

    -- não repete: mesmo conjunto já roteado, ou tarefa desta tela ainda aberta
    IF EXISTS (SELECT 1 FROM hub_gap_roteado h WHERE h.rota = d.rota_prefixo AND h.hash_gaps = v_hash)
       OR EXISTS (SELECT 1 FROM erp_agente_mensagem m
                   WHERE m.para = d.code AND m.status IN ('nova', 'em_andamento', 'recebida')
                     AND coalesce(m.arquivada, false) = false
                     AND m.assunto LIKE 'GAPS Hub · ' || d.rota_prefixo || '%') THEN
      v_pulou := v_pulou + 1;
      CONTINUE;
    END IF;

    -- relê a lista dos 15 mais graves (quebrado → ausente → parcial)
    SELECT coalesce(array_to_string((array_agg('- [' || upper(st) || '] ' || requisito
             || CASE WHEN ev IS NOT NULL AND ev <> '' THEN ' — ' || left(ev, 160) ELSE '' END
             ORDER BY ord, prioridade, requisito))[1:15], E'\n'), '')
      INTO v_lista
      FROM (
        SELECT r.requisito, r.prioridade,
               coalesce((SELECT c.status FROM blueprint_tela_cobertura c WHERE c.requisito_id = r.id
                          ORDER BY c.avaliado_em DESC LIMIT 1), r.status_baseline) AS st,
               (SELECT c.evidencia FROM blueprint_tela_cobertura c WHERE c.requisito_id = r.id
                 ORDER BY c.avaliado_em DESC LIMIT 1) AS ev,
               CASE coalesce((SELECT c.status FROM blueprint_tela_cobertura c WHERE c.requisito_id = r.id ORDER BY c.avaliado_em DESC LIMIT 1), r.status_baseline) WHEN 'quebrado' THEN 0 WHEN 'ausente' THEN 1 ELSE 2 END AS ord
          FROM blueprint_tela_requisito r
         WHERE r.rota_padrao = d.rota_prefixo AND r.tipo IS DISTINCT FROM 'nao_construir'
      ) q
     WHERE st IN ('quebrado', 'ausente', 'parcial') AND ord < 3;

    PERFORM public.fn_agente_mensagem_enviar(
      d.code, 'eng_chefe', 'tarefa', v_assunto,
      'O auditor (login real, DEMO Construtora) deixou ' || v_n || ' requisito(s) desta tela sem estar atendidos. '
      || 'Tela: ' || d.rota_prefixo || E'\nGaps (até 15; a lista completa está em blueprint_tela_cobertura):\n'
      || coalesce(nullif(v_lista, ''), '(ver blueprint_tela_requisito)')
      || E'\n\nCorrija um por PR pequena (label hub, urgente: FC Pisos terça). A tela só é LIBERADA a 100% '
      || '(visual + funcional + cálculo + Gold). O auditor reaudita sozinho e esta tarefa volta se sobrar gap. '
      || 'Responda ENTREGUE / EM TESTE / PRÓXIMO.',
      false, 'eng_chefe');

    INSERT INTO hub_gap_roteado (rota, code, hash_gaps, n_gaps, enviado_em)
    VALUES (d.rota_prefixo, d.code, v_hash, v_n, now())
    ON CONFLICT (rota) DO UPDATE SET code = EXCLUDED.code, hash_gaps = EXCLUDED.hash_gaps,
                                     n_gaps = EXCLUDED.n_gaps, enviado_em = EXCLUDED.enviado_em;

    v_rotas := v_rotas + 1;
    v_detalhe := v_detalhe || jsonb_build_object('rota', d.rota_prefixo, 'code', d.code, 'gaps', v_n);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'roteadas', v_rotas, 'sem_mudanca', v_pulou, 'detalhe', v_detalhe, 'em', now());
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_hub_rotear_gaps(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_hub_rotear_gaps(integer) TO service_role;

-- 4) A cada 20 min (idempotente: cron.schedule faz upsert pelo nome do job).
SELECT cron.schedule('hub-rotear-gaps-20min', '*/20 * * * *', $cron$SELECT public.fn_hub_rotear_gaps();$cron$);
