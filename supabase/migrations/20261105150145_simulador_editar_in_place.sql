-- RD-98 p2 (CRUD) · Simulador de Obra: EDITAR in-place uma simulação salva.
-- Problema: fn_simulador_salvar NÃO recebe p_id — todo "Salvar" cria um registro NOVO, então
-- renomear/ajustar uma simulação salva duplicava em vez de atualizar. Esta função ATUALIZA o
-- MESMO registro: troca o nome e, quando a montagem/metragem/cliente mudam, re-simula pelo motor
-- fn_simular_montagem e regrava os totais (mesmas expressões provadas de fn_simulador_salvar).
--
-- Aditiva: função NOVA (não altera fn_simulador_salvar/_excluir). Company-scoped via
-- fn__guarda_empresa (a empresa vem do próprio registro, não é parâmetro), REVOKE anon,
-- auditada em audit_log_global (ação 'editar', valor_anterior/valor_novo). Soft-delete respeitado
-- (só edita registro com excluido_em IS NULL).
CREATE OR REPLACE FUNCTION public.fn_simulador_editar(
  p_id uuid,
  p_nome text,
  p_servico_id uuid DEFAULT NULL,
  p_business_line_id uuid DEFAULT NULL,
  p_area numeric DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.erp_hub_simulacao%ROWTYPE;
  v_servico uuid; v_area numeric; v_cliente uuid; r jsonb;
BEGIN
  SELECT * INTO v_row FROM public.erp_hub_simulacao WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Simulação não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(v_row.company_id);
  IF length(btrim(coalesce(p_nome, ''))) < 2 THEN RAISE EXCEPTION 'Dê um nome para a simulação.'; END IF;

  -- Campos não enviados mantêm o valor atual (edição parcial: só o nome, por exemplo).
  v_servico := coalesce(p_servico_id, v_row.servico_id);
  v_area    := coalesce(p_area, v_row.area);
  v_cliente := coalesce(p_cliente_id, v_row.cliente_id);
  IF v_area IS NULL OR v_area <= 0 THEN RAISE EXCEPTION 'Informe uma metragem maior que zero.'; END IF;

  r := public.fn_simular_montagem(v_servico, v_row.company_id, p_business_line_id, v_area);
  IF coalesce((r->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Não foi possível simular esta montagem (%).', coalesce(r->>'erro', 'sem detalhe');
  END IF;

  UPDATE public.erp_hub_simulacao SET
    nome       = btrim(p_nome),
    servico_id = v_servico,
    montagem   = r->>'montagem',
    unidade    = r->>'unidade',
    area       = v_area,
    total_obra = nullif(r->>'total_obra', '')::numeric,
    total_m2   = nullif(r#>>'{preco_m2,total_m2}', '')::numeric,
    margem_pct = nullif(r#>>'{preco_m2,margem_pct}', '')::numeric,
    resultado  = r,
    cliente_id = v_cliente
  WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_row.company_id, auth.uid(), 'erp_hub_simulacao', p_id::text, 'editar',
            jsonb_build_object('nome', v_row.nome, 'area', v_row.area, 'total_obra', v_row.total_obra),
            jsonb_build_object('nome', btrim(p_nome), 'area', v_area, 'total_obra', r->'total_obra'));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_simulador_editar(uuid, text, uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulador_editar(uuid, text, uuid, uuid, numeric, uuid) TO authenticated, service_role;

-- RD-95 — "?" da ação "Editar" das simulações salvas (texto da ajuda, aditivo, idempotente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub', 'publicado'
FROM (VALUES
 ('projetos.simulador.editar', 'Salvas', 'Editar simulação',
  'Carrega a simulação salva no formulário acima para você ajustar a montagem, a metragem ou só o nome e salvar por cima.',
  'Corrige uma simulação sem criar uma cópia: o mesmo registro é atualizado (antes, salvar de novo duplicava na lista).',
  'Abrir "Piso galpão — 450 m²", mudar a metragem para 500 e clicar em Atualizar: a mesma linha passa a mostrar 500 m² e o novo total.',
  'Esperar que Editar crie uma nova simulação: ele atualiza a que você escolheu. Para guardar as duas, use Salvar simulação (cria outra).',
  989, '/dashboard/projetos/simulador')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
