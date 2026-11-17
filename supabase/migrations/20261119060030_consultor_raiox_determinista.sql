-- Consultor · Raio-X determinístico dos dados (CUSTO ZERO de IA) — SPEC Eng. Chefe (RD-41, caminho A / 🅰️)
--
-- Diagnóstico (RD-26/RD-38, auditado no banco): a tela /dashboard/consultor-ia já existe (área Inteligência)
-- e os detectores determinísticos já existem. Esta migration NÃO recria nada: cria um agregador guardado que
-- normaliza os detectores existentes numa lista única de achados, e fecha o único buraco de Pilar 2 que restava.
--
-- Pilar 2 (multi-tenant/LGPD) — o que a auditoria VIVA mostrou (pg_get_functiondef em 17/11):
--   • fn_ge_saude_financeira, fn_saldo_bancos_dinamico, fn_saude_alertas_proativos JÁ carregam
--     `fn__guarda_empresa(p_company_id)` (fail-closed). Não são reescritas aqui (RD-26: não mexer no que já está certo).
--   • fn_conciliacao_orfaos (SECURITY DEFINER) era a ÚNICA sem guarda — chamada direta por usuário de outra
--     empresa vazava outro CNPJ. Esta migration adiciona a MESMA guarda dos irmãos, sem tocar a lógica.
--   • fn_conciliacao_pendencias_sistema NÃO é SECURITY DEFINER (roda sob RLS das tabelas) e filtra por
--     company_id explícito — segue protegida.
--
-- CUSTO ZERO (RD-101/RD-42): nenhuma função aqui chama LLM/API. Tudo é SQL determinístico. Zero token.

-- ============================================================================================================
-- 1) Hardening Pilar 2 — guarda de empresa em fn_conciliacao_orfaos (mesma cláusula dos irmãos: fn__guarda_empresa)
--    Conteúdo lógico INALTERADO; só a 1ª instrução (guarda) foi acrescentada. (fn__guarda_empresa: service/interno
--    sem JWT e admin passam; usuário só na própria empresa — senão RAISE 42501.)
-- ============================================================================================================
CREATE OR REPLACE FUNCTION public.fn_conciliacao_orfaos(p_company uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Pilar 2 (CEO/Eng. Chefe): fail-closed. Usuário só vê órfãos da própria empresa; service/admin passam.
  SELECT public.fn__guarda_empresa(p_company);
  -- Órfão REAL = movimento conciliado sem vínculo de título E sem link direto de transferência.
  WITH orf AS (
    SELECT m.* FROM conciliacao_movimento m
    WHERE m.status='conciliado'
      AND (p_company IS NULL OR m.company_id=p_company)
      AND NOT EXISTS (SELECT 1 FROM conciliacao_vinculo v WHERE v.movimento_id=m.id)
      AND NOT (m.lancamento_tabela='erp_transferencia' AND m.lancamento_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM erp_transferencia t WHERE t.id=m.lancamento_id))
  )
  SELECT jsonb_build_object(
    'ok', true,
    'orfaos_reais', (SELECT count(*) FROM orf),
    'por_categoria', (SELECT coalesce(jsonb_object_agg(cat, n),'{}'::jsonb) FROM (
        SELECT CASE WHEN descricao ILIKE 'PIX%' THEN 'pix_sem_titulo'
                    WHEN natureza='credito' THEN 'recebimento_sem_titulo'
                    ELSE 'pagamento_sem_titulo' END AS cat, count(*) n
        FROM orf GROUP BY 1) q),
    'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'empresa', coalesce(c.nome_fantasia,c.razao_social),
        'data', o.data_transacao, 'valor', o.valor, 'natureza', o.natureza,
        'descricao', left(o.descricao,60), 'motivo', o.motivo_status) ORDER BY o.data_transacao),'[]'::jsonb)
      FROM orf o LEFT JOIN companies c ON c.id=o.company_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_orfaos(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_orfaos(uuid) TO authenticated, service_role;

-- ============================================================================================================
-- 2) NOVO agregador guardado — fn_consultor_raiox(company) : o "raio-X" determinístico que a tela consome.
--    Guarda de empresa no topo (fail-closed, retorna sem_acesso). Só depois chama os detectores (passando o
--    MESMO p_company_id guardado) e normaliza tudo numa lista de achados. Nenhuma chamada a IA/API.
-- ============================================================================================================
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
REVOKE ALL ON FUNCTION public.fn_consultor_raiox(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_raiox(uuid) TO authenticated, service_role;

-- ============================================================================================================
-- 3) Catálogo de tela + Ajuda RD-95
-- ============================================================================================================
UPDATE public.system_screens
   SET titulo = 'Consultor · Raio-X dos seus dados',
       estado_real = 'pronto',
       rpcs_chamadas = ARRAY['fn_consultor_raiox']
 WHERE rota = '/dashboard/consultor-ia';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('inteligencia.consultor.empresa','/dashboard/consultor-ia','Consultor','Empresa analisada',
   'Escolha de qual empresa (CNPJ) o Consultor vai ler as contas a pagar, a receber, boletos e saldos.',
   'Define o conjunto de dados que será analisado — o raio-X olha SÓ os números dessa empresa (nunca de outra).',
   'Selecione "Pdois" para analisar os dados da Pdois.',
   'Analisar com a empresa errada selecionada e achar que o resultado é de outra.',
   'nucleo', 10, 1, 'ativo'),
  ('inteligencia.consultor.sintoma','/dashboard/consultor-ia','Consultor','O que está acontecendo',
   'Descreva em poucas palavras o problema (ex.: "meu saldo não bate") ou use um dos atalhos de sintoma.',
   'Filtra os achados do raio-X pela sua dúvida — é um casamento por palavra-chave (saldo, boleto, conciliação, cliente/fornecedor), sem custo de IA.',
   'Digite "boleto sem baixa" para ver só os achados de conciliação.',
   'Esperar uma resposta de chat — aqui o sistema ANALISA seus dados e lista o que está errado e como corrigir.',
   'nucleo', 20, 1, 'ativo')
ON CONFLICT (chave) DO UPDATE SET
   rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
   o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
   exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = 'ativo';
