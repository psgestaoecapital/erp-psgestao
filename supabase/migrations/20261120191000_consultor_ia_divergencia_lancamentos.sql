-- Consultor IA (CEO 18/11): diagnóstico de divergência (saldo do sistema × banco) e detalhe de lançamentos com
-- valor, data, contraparte, CNPJ e link para corrigir. SOMENTE LEITURA, guardado por empresa (fail-closed).
-- Arquitetura intacta: o LLM só escolhe a ferramenta; estas RPCs rodam no servidor com o company_id validado.
-- Reusa: fn_saldo_gerencial_contas (diferença por conta), os critérios de pendência da Conciliação
-- (conciliacao_vinculo / conciliacao_movimento) e erp_pagar / erp_receber / erp_fornecedores / erp_clientes.
-- Links reais (RD-38): conciliação = /dashboard/financeiro/conciliacao/inbox (a tela não aceita filtro por conta);
-- título = /dashboard/financeiro/nova-despesa?editar=<id> e /dashboard/financeiro/nova-receita?editar=<id> (#71).

-- ── 1. Divergência por conta ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_consultor_divergencia_contas(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_contas jsonb; v_sem jsonb; v_total numeric;
BEGIN
  -- Guarda de empresa (fail-closed): só o vínculo do próprio usuário (get_user_company_ids); interno/serviço passam.
  IF p_company_id IS NULL OR NOT (v_interno OR auth.role() = 'service_role' OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  WITH g AS (
    SELECT * FROM public.fn_saldo_gerencial_contas(ARRAY[p_company_id]) s
     WHERE s.conta_id IS NOT NULL AND s.soma_no_saldo AND s.company_id = p_company_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'conta_id', g.conta_id, 'conta_nome', g.nome,
      'saldo_sistema', g.saldo_gerencial, 'saldo_banco', g.saldo_extrato, 'diferenca', g.diferenca,
      'n_titulos', g.n_titulos, 'rota_link', '/dashboard/financeiro/conciliacao/inbox'
    ) ORDER BY abs(g.diferenca) DESC) FILTER (WHERE g.saldo_extrato IS NOT NULL AND round(g.diferenca, 2) <> 0), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('conta_nome', g.nome, 'saldo_sistema', g.saldo_gerencial)
      ORDER BY g.nome) FILTER (WHERE g.saldo_extrato IS NULL), '[]'::jsonb),
    COALESCE(sum(g.diferenca) FILTER (WHERE g.saldo_extrato IS NOT NULL AND round(g.diferenca, 2) <> 0), 0)
  INTO v_contas, v_sem, v_total
  FROM g;

  RETURN jsonb_build_object(
    'ok', true,
    'tem_divergencia', jsonb_array_length(v_contas) > 0,
    'total_diferenca', round(v_total, 2),
    'contas', v_contas,
    'contas_sem_extrato', v_sem
  );
END $function$;

-- ── 2. Detalhe de lançamentos (sem conciliar / sem CNPJ / busca) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_consultor_lancamentos_detalhe(
  p_company_id uuid, p_filtro text, p_termo text DEFAULT NULL, p_conta text DEFAULT NULL, p_limite integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_filtro text := lower(btrim(coalesce(p_filtro, '')));
  v_termo text := NULLIF(btrim(coalesce(p_termo, '')), '');
  v_conta text := NULLIF(lower(btrim(coalesce(p_conta, ''))), '');
  v_lim int := GREATEST(1, LEAST(COALESCE(p_limite, 50), 100));
  v_valor numeric;
  v_total int; v_linhas jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (v_interno OR auth.role() = 'service_role' OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_filtro NOT IN ('nao_conciliados', 'sem_cnpj', 'por_termo') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'filtro_invalido');
  END IF;
  IF v_filtro = 'por_termo' AND (v_termo IS NULL OR length(v_termo) < 2) THEN
    RETURN jsonb_build_object('ok', true, 'filtro', v_filtro, 'total', 0, 'linhas', '[]'::jsonb);
  END IF;
  -- valor exato: aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234,56"
  IF v_termo IS NOT NULL AND v_termo ~ '^\s*(R\$)?\s*[0-9][0-9.,]*\s*$' THEN
    BEGIN
      v_valor := CASE
        WHEN v_termo ~ ',' THEN replace(replace(regexp_replace(v_termo, '[^0-9.,]', '', 'g'), '.', ''), ',', '.')::numeric
        ELSE regexp_replace(v_termo, '[^0-9.]', '', 'g')::numeric END;
    EXCEPTION WHEN OTHERS THEN v_valor := NULL;
    END;
  END IF;

  WITH base AS (
    SELECT 'erp_pagar'::text AS tabela, p.id, 'pagar'::text AS natureza, p.descricao::text AS descricao,
           COALESCE(NULLIF(btrim(f.nome_fantasia), ''), NULLIF(btrim(f.razao_social), ''), NULLIF(btrim(p.fornecedor_nome), '')) AS contraparte_nome,
           NULLIF(btrim(COALESCE(NULLIF(btrim(f.cpf_cnpj), ''), f.cnpj_cpf)), '') AS contraparte_cnpj,
           (p.fornecedor_id IS NOT NULL AND f.id IS NOT NULL) AS tem_cadastro,
           p.numero_documento::text AS numero_documento, p.numero_nf::text AS numero_nf,
           p.valor, p.data_vencimento, p.data_pagamento, p.status::text AS status, COALESCE(p.conciliado, false) AS conciliado,
           NULLIF(btrim(p.conta_bancaria), '')::text AS conta,
           (p.status IN ('pago', 'parcial')) AS liquidado,
           '/dashboard/financeiro/nova-despesa?editar=' || p.id::text AS rota_link
      FROM erp_pagar p
      LEFT JOIN erp_fornecedores f ON f.id = p.fornecedor_id AND f.company_id = p.company_id
     WHERE p.company_id = p_company_id AND p.deleted_at IS NULL AND COALESCE(p.status, '') <> 'cancelado'
    UNION ALL
    SELECT 'erp_receber'::text, r.id, 'receber'::text, r.descricao::text,
           COALESCE(NULLIF(btrim(c.nome_fantasia), ''), NULLIF(btrim(c.razao_social), ''), NULLIF(btrim(r.cliente_nome), '')),
           NULLIF(btrim(COALESCE(NULLIF(btrim(c.cpf_cnpj), ''), c.cnpj_cpf)), ''),
           (r.cliente_id IS NOT NULL AND c.id IS NOT NULL),
           r.numero_documento::text, r.numero_nf::text,
           r.valor, r.data_vencimento, r.data_pagamento, r.status::text, COALESCE(r.conciliado, false),
           COALESCE(bc.nome::text, NULLIF(btrim(r.conta_bancaria), '')::text),
           (r.status IN ('recebido', 'pago', 'parcial')),
           '/dashboard/financeiro/nova-receita?editar=' || r.id::text
      FROM erp_receber r
      LEFT JOIN erp_clientes c ON c.id = r.cliente_id AND c.company_id = r.company_id
      LEFT JOIN erp_banco_contas bc ON bc.id = r.conta_bancaria_id AND bc.company_id = r.company_id
     WHERE r.company_id = p_company_id AND r.deleted_at IS NULL
       AND COALESCE(r.status, '') NOT IN ('cancelado', 'orcamento', 'renegociado')
  ),
  filtrado AS (
    SELECT b.* FROM base b
     WHERE (v_conta IS NULL OR lower(COALESCE(b.conta, '')) LIKE '%' || v_conta || '%')
       AND CASE v_filtro
         -- sem conciliar = já pago/recebido (mexeu no banco) e sem vínculo na Conciliação: é o que faz o saldo não bater
         WHEN 'nao_conciliados' THEN b.liquidado AND NOT b.conciliado
              AND NOT EXISTS (SELECT 1 FROM conciliacao_vinculo v WHERE v.lancamento_tabela = b.tabela AND v.lancamento_id = b.id)
              AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento m WHERE m.lancamento_tabela = b.tabela AND m.lancamento_id = b.id AND m.status = 'conciliado')
         WHEN 'sem_cnpj' THEN (NOT b.tem_cadastro OR b.contraparte_cnpj IS NULL)
         ELSE ( b.descricao ILIKE '%' || v_termo || '%'
             OR b.numero_documento ILIKE '%' || v_termo || '%'
             OR b.numero_nf ILIKE '%' || v_termo || '%'
             OR b.contraparte_nome ILIKE '%' || v_termo || '%'
             OR (v_valor IS NOT NULL AND b.valor = v_valor) )
       END
  )
  SELECT (SELECT count(*) FROM filtrado)::int,
         COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'tem_cadastro' - 'liquidado') FROM (
            SELECT * FROM filtrado ORDER BY data_vencimento DESC NULLS LAST, valor DESC LIMIT v_lim) x), '[]'::jsonb)
    INTO v_total, v_linhas;

  RETURN jsonb_build_object('ok', true, 'filtro', v_filtro, 'total', v_total, 'mostrando', jsonb_array_length(v_linhas), 'linhas', v_linhas);
END $function$;

REVOKE ALL ON FUNCTION public.fn_consultor_divergencia_contas(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_consultor_lancamentos_detalhe(uuid, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_divergencia_contas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_consultor_lancamentos_detalhe(uuid, text, text, text, integer) TO authenticated, service_role;

-- ── 3. Raio-X com o NÚMERO da divergência (CREATE OR REPLACE da versão viva de 20261119101330 + bloco b2) ────
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
                           to_char((v_item->>'diferenca')::numeric,'FM999G999G990D00'),
                           to_char((v_item->>'saldo_sistema')::numeric,'FM999G999G990D00'),
                           to_char((v_item->>'saldo_banco')::numeric,'FM999G999G990D00')),
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
      'mensagem', format('O saldo gerencial das suas contas está em R$ %s (negativo). Normalmente é baixa em duplicidade, transferência entre contas não registrada ou título sem conciliar.', to_char(v_saldo,'FM999G999G990D00')),
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

-- ── 4. Ajuda "?" (RD-95): o texto antigo descrevia o filtro por palavra-chave da V1; agora é o assistente ───────
UPDATE public.erp_ajuda_campo SET
  rotulo = 'Pergunte sobre seus dados',
  o_que_preencher = 'Escreva a pergunta em português ou toque num atalho. Ex.: "meu saldo bate com o banco?", "lançamentos sem conciliar", "tem lançamento sem CNPJ?", "procure o lançamento de 379,00".',
  para_que_serve = 'O assistente entende a pergunta e escolhe uma consulta pronta: contas a pagar e a receber, saldo, inadimplentes, saldo do sistema × banco por conta, lançamentos sem conciliar, sem CNPJ, busca de lançamento ou de cliente e o Raio-X. Os números vêm direto dos dados da empresa escolhida no topo, com o botão para abrir e corrigir.',
  exemplo = 'Pergunte "meu saldo bate com o banco?" para ver a diferença exata de cada conta e abrir a conciliação.',
  erro_comum = 'Perguntar sobre outra empresa sem trocar no seletor do topo: o assistente só lê o CNPJ que está selecionado.',
  versao = versao + 1,
  atualizado_em = now()
WHERE chave = 'inteligencia.consultor.sintoma' AND rotulo IS DISTINCT FROM 'Pergunte sobre seus dados';
