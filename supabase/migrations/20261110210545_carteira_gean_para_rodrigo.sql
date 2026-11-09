-- Movimento pontual da GEAN AUTO MECANICA (a462e13f-0f51-4c54-abe8-4474b591633b) da Jordana para o Rodrigo (CEO 09/11).
-- Só a Gean. Não altera roteamento global (fn__chamado_agente_dono_i, fn_chamados_rotear) nem outros clientes.
--
-- 1) RESPONSÁVEL: chamados ABERTOS da Gean hoje com a Jordana (agente jordana-code ou responsavel_id da Jordana)
--    passam a responsavel_id = Rodrigo e agente = rodrigo-code. Com isso o escopo do sócio (fn__agente_escopo_chamado_i)
--    reconhece o Rodrigo como dono desses chamados.
-- 2) CAIXA: as mensagens ABERTAS da jordana-code ligadas a chamados da Gean (por chamado_numero) são arquivadas e
--    reenviadas ao rodrigo-code, com o vínculo ao número do chamado preservado. O remetente da origem (jordana-chat) não
--    pode ser reaproveitado na caixa de outro sócio (a caixa recusa remetente-chat de outro sócio); por isso o reenvio é
--    tarefa do sistema (de = eng_chefe, como o roteador faz) e o texto original vai precedido da origem.
--    Idempotente: se já há mensagem aberta do rodrigo-code com o mesmo número e assunto, não duplica.
--    Auditado: enviado_por = 'migracao-carteira-gean'.
-- Não toca: outros clientes da Jordana, carteira (erp_carteira_responsavel), roteamento global.

DO $gean$
DECLARE
  v_gean uuid := 'a462e13f-0f51-4c54-abe8-4474b591633b';
  v_rod uuid := '33464170-036f-4d3b-bc48-f2dc3dfde660';
  v_jor uuid := '43ef8386-3262-4e56-b31a-6f0e41d1e21c';
  r record;
  v_res jsonb;
  v_resp int := 0;
  v_reenviadas int := 0;
  v_ja_existia int := 0;
BEGIN
  -- 1) responsável dos chamados abertos da Gean que estão com a Jordana
  WITH upd AS (
    UPDATE public.sugestoes s
       SET responsavel_id = v_rod, agente = 'rodrigo-code', ultimo_movimento = now()
     WHERE s.company_id = v_gean
       AND s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
       AND (s.agente = 'jordana-code' OR s.responsavel_id = v_jor)
    RETURNING 1
  )
  SELECT count(*) INTO v_resp FROM upd;

  -- 2) mensagens abertas da jordana-code de chamados da Gean: reenvia ao rodrigo-code e arquiva a original
  FOR r IN
    SELECT m.id, m.de, m.tipo, m.assunto, m.corpo, m.requer_ok_ceo, m.sensivel, m.sugestao_id, m.chamado_numero
      FROM public.erp_agente_mensagem m
      JOIN public.sugestoes s ON s.numero = m.chamado_numero
     WHERE m.para = 'jordana-code'
       AND m.status IN ('nova', 'recebida', 'em_andamento')
       AND NOT coalesce(m.arquivada, false)
       AND s.company_id = v_gean
     ORDER BY m.criado_em
  LOOP
    IF EXISTS (SELECT 1 FROM public.erp_agente_mensagem x
                WHERE x.para = 'rodrigo-code' AND x.chamado_numero = r.chamado_numero AND x.assunto = r.assunto
                  AND x.status IN ('nova', 'recebida', 'em_andamento') AND NOT coalesce(x.arquivada, false)) THEN
      v_ja_existia := v_ja_existia + 1;
    ELSE
      v_res := public.fn_agente_mensagem_enviar(
        'rodrigo-code', 'eng_chefe', r.tipo, r.assunto,
        'Reencaminhado da caixa da Jordana (pedido original de ' || r.de || ', CEO 09/11: carteira da Gean com o Rodrigo).' || E'\n\n'
        || coalesce(r.corpo, ''),
        coalesce(r.requer_ok_ceo, false), 'migracao-carteira-gean');
      UPDATE public.erp_agente_mensagem
         SET sugestao_id = r.sugestao_id, chamado_numero = r.chamado_numero, sensivel = coalesce(r.sensivel, false)
       WHERE id = (v_res ->> 'id')::uuid;
      v_reenviadas := v_reenviadas + 1;
    END IF;
    PERFORM public.fn_agente_mensagem_arquivar(r.id);
  END LOOP;

  RAISE NOTICE 'carteira gean: responsaveis % | reenviadas % | ja existiam %', v_resp, v_reenviadas, v_ja_existia;
END
$gean$;
