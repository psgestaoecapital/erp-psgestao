-- Raio-X: valores em reais no formato brasileiro (R$ 5.318,91), independente do lc_numeric do banco.
-- A versão anterior usava to_char(...,'FM999G999G990D00'), que em produção sai "5,318.91".
-- CREATE OR REPLACE da versão viva (20261120191000) trocando só a formatação.
CREATE OR REPLACE FUNCTION public.fn_consultor_raiox(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_ach jsonb := '[]'::jsonb;
  v_item jsonb;
  v_saldo numeric;
  v_pend int;
  v_orfaos int;
  v_insights jsonb;
  v_alertas jsonb;
  v_alta int := 0; v_media int := 0; v_baixa int := 0;
  v_div jsonb;
BEGIN
  -- Pilar 2: guarda de empresa (fail-closed). service/interno (sem JWT) e admin passam; usuário só na própria empresa.
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- (a) SALDO gerencial das contas (detector já guardado)
  v_saldo := public.fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  -- (b) CONCILIAÇÃO: pendências do sistema (não-DEFINER, filtra por company) + órfãos do banco (DEFINER guardado)
  SELECT count(*) INTO v_pend
    FROM public.fn_conciliacao_pendencias_sistema(p_company_id, NULL, NULL, NULL, 500);
  v_orfaos := COALESCE((public.fn_conciliacao_orfaos(p_company_id) ->> 'orfaos_reais')::int, 0);

  IF v_pend > 0 OR v_orfaos > 0 THEN
    v_ach := v_ach || jsonb_build_object(
      'codigo','conciliacao_pendente','categoria','conciliacao',
      'severidade', CASE WHEN v_orfaos > 0 THEN 'alta' ELSE 'media' END,
      'titulo','Itens sem conciliação',
      'mensagem', format('Há %s lançamento(s) do sistema sem conciliar e %s movimento(s) do banco sem vínculo. Enquanto não concilia, o saldo pode não bater com o extrato.', v_pend, v_orfaos),
      'como_corrigir','Abra a Conciliação, selecione o lote e vincule cada lançamento ao movimento do extrato.',
      'rota_link','/dashboard/financeiro/conciliacao/inbox',
      'metricas', jsonb_build_object('pendencias', v_pend, 'orfaos', v_orfaos)
    );
  END IF;

  -- (b2) DIVERGÊNCIA por conta (CEO 18/11): o número exato, não só "pode não bater".
  v_div := public.fn_consultor_divergencia_contas(p_company_id);
  IF COALESCE((v_div->>'tem_divergencia')::boolean, false) THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_div->'contas') LOOP
      v_ach := v_ach || jsonb_build_object(
        'codigo','divergencia_conta','categoria','conciliacao','severidade','alta',
        'titulo','Conta não bate com o banco',
        'mensagem', format('A conta %s está com R$ %s de diferença: sistema R$ %s × banco R$ %s. Normalmente são lançamentos sem conciliar, baixa em duplicidade ou transferência não registrada.',
                           v_item->>'conta_nome',
                           translate(to_char((v_item->>'diferenca')::numeric,'FM999,999,990.00'), ',.', '.,'),
                           translate(to_char((v_item->>'saldo_sistema')::numeric,'FM999,999,990.00'), ',.', '.,'),
                           translate(to_char((v_item->>'saldo_banco')::numeric,'FM999,999,990.00'), ',.', '.,')),
        'como_corrigir','Abra a Conciliação dessa conta e vincule cada lançamento ao movimento do extrato.',
        'rota_link', COALESCE(v_item->>'rota_link','/dashboard/financeiro/conciliacao/inbox'),
        'metricas', jsonb_build_object('saldo_sistema', v_item->'saldo_sistema', 'saldo_banco', v_item->'saldo_banco',
                                       'diferenca', v_item->'diferenca', 'n_titulos', v_item->'n_titulos')
      );
    END LOOP;
  END IF;

  -- (c) SALDO negativo = sinal duro de problema (duplicidade de baixa, transferência não registrada, etc.)
  IF v_saldo < 0 THEN
    v_ach := v_ach || jsonb_build_object(
      'codigo','saldo_negativo','categoria','saldo','severidade','alta',
      'titulo','Saldo das contas negativo',
      'mensagem', format('O saldo gerencial das suas contas está em R$ %s (negativo). Normalmente é baixa em duplicidade, transferência entre contas não registrada ou título sem conciliar.', translate(to_char(v_saldo,'FM999,999,990.00'), ',.', '.,')),
      'como_corrigir','Revise os lançamentos e baixas recentes, registre transferências entre contas e concilie o extrato.',
      'rota_link','/dashboard/financeiro/conciliacao/inbox',
      'metricas', jsonb_build_object('saldo', v_saldo)
    );
  END IF;

  -- (d) INSIGHTS determinísticos (qualidade de dados, saúde, aging, tendência, concentração)
  v_insights := COALESCE(public.fn_consultor_insights(p_company_id, NULL, NULL) -> 'insights', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_insights) LOOP
    v_ach := v_ach || jsonb_build_object(
      'codigo', 'insight:'||COALESCE(v_item->>'tipo','?'),
      'categoria', CASE WHEN v_item->>'tipo' = 'qualidade_dados' THEN 'qualidade_dados' ELSE 'saude' END,
      'severidade', COALESCE(v_item->>'severidade','baixa'),
      'titulo', v_item->>'titulo',
      'mensagem', v_item->>'mensagem',
      'como_corrigir', CASE v_item->>'tipo'
        WHEN 'qualidade_dados' THEN 'Preencha o fornecedor/cliente dos lançamentos em branco (ou ajuste a importação dos dados).'
        WHEN 'aging_pagar' THEN 'Priorize a quitação ou a renegociação dos títulos vencidos há mais tempo.'
        WHEN 'tendencia_receita' THEN 'Investigue a causa da variação (cliente, sazonalidade ou operação) no Resultado por negócio.'
        WHEN 'top_cliente' THEN 'Reduza a dependência diversificando a carteira de clientes.'
        WHEN 'top_fornecedor' THEN 'Negocie prazo, desconto à vista ou condições com o fornecedor concentrado.'
        WHEN 'sazonalidade_custos' THEN 'Verifique lançamentos extraordinários (13º, férias, impostos anuais) na despesa fixa.'
        ELSE 'Acompanhe o indicador na tela de Saúde financeira.' END,
      'rota_link', CASE WHEN v_item->>'tipo' IN ('qualidade_dados','aging_pagar') THEN '/dashboard/financeiro/pagar' ELSE '/dashboard/financeiro/saude' END,
      'metricas', COALESCE(v_item->'metricas','{}'::jsonb)
    );
  END LOOP;

  -- (e) ALERTAS proativos de saúde (caixa baixo, inadimplência, concentração) — detector já guardado
  v_alertas := COALESCE(public.fn_saude_alertas_proativos(p_company_id) -> 'alertas', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_alertas) LOOP
    v_ach := v_ach || jsonb_build_object(
      'codigo', 'alerta:'||COALESCE(v_item->>'titulo','?'),
      'categoria','saude',
      'severidade', CASE v_item->>'tipo' WHEN 'critico' THEN 'alta' WHEN 'aviso' THEN 'media' ELSE 'baixa' END,
      'titulo', v_item->>'titulo',
      'mensagem', v_item->>'mensagem',
      'como_corrigir', COALESCE(NULLIF(v_item->>'acao_sugerida',''),'Acompanhe o indicador na tela de Saúde financeira.'),
      'rota_link','/dashboard/financeiro/saude',
      'metricas', '{}'::jsonb
    );
  END LOOP;

  -- resumo por severidade (cabeçalho da tela)
  SELECT
    count(*) FILTER (WHERE a->>'severidade'='alta'),
    count(*) FILTER (WHERE a->>'severidade'='media'),
    count(*) FILTER (WHERE a->>'severidade'='baixa')
  INTO v_alta, v_media, v_baixa
  FROM jsonb_array_elements(v_ach) a;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'gerado_em', now(),
    'saldo_gerencial', v_saldo,
    'resumo', jsonb_build_object('alta', v_alta, 'media', v_media, 'baixa', v_baixa, 'total', jsonb_array_length(v_ach)),
    'achados', v_ach
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_consultor_raiox(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_raiox(uuid) TO authenticated, service_role;
