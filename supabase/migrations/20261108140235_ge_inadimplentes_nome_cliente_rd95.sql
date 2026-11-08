-- Gestão Empresarial · Inadimplentes (/dashboard/financeiro/inadimplentes · fn_inadimplentes_por_status)
-- aud8 70/95 (matriz #2635).
-- GAP 1: o "maior devedor" aparecia como "(sem nome)". Causa (RD-38): fn_inadimplentes_por_status deriva o nome SÓ do
--   join com erp_clientes (COALESCE(cli.nome_fantasia, cli.razao_social)); títulos SEM cliente_id (sem cadastro) caíam
--   todos num único grupo (GROUP BY er.cliente_id => todos os null juntos) e, sem linha em erp_clientes, o nome ficava
--   nulo. Na DEMO "Comércio (GE)" eram 10 títulos (R$ 10.088,73) com cliente_id null — 6 deles TINHAM nome
--   desnormalizado em er.cliente_nome, que a função ignorava.
-- CORREÇÃO: (a) agrupar os títulos SEM cliente_id pelo nome desnormalizado (cada cliente-sem-cadastro vira um grupo
--   próprio, com o nome real); (b) nome = COALESCE(cadastro, nome do título, 'Cliente sem cadastro') — nunca "(sem nome)".
--   O cliente_id do grupo passa a MAX(cliente_id::text)::uuid (uuid não tem MIN/MAX direto).
--   count/total_valor do topo não mudam; só a quebra por cliente (agrupado_cliente) fica correta.
--
-- Prova RD-38 (BEGIN/ROLLBACK, DEMO Comércio GE, timeout 25s):
--   ANTES:  1 grupo "(sem nome)" (R$ 10.088,73) no topo.
--   DEPOIS: 0 grupos "(sem nome)"; 11 grupos; maior devedor "Cliente Demo PF 12" (R$ 7.039,65); exatamente 1 grupo
--           "Cliente sem cadastro" para os títulos realmente sem nome.
--
-- GAP 2 (RD-95): a tela tinha 0 AjudaCampo / 0 chaves. Aqui entram as chaves das abas, do TOTAL ATRASADO, do ordenador
--   e da ação por linha (o "?" no .tsx acompanha nesta PR).
-- GAP 3 (RD-98 p3): origem do dado da tela (views/RPCs) em system_screens.
--
-- SENSÍVEL (RD-94.1): CREATE OR REPLACE de função financeira existente → revisao-eng-chefe. Só leitura (STABLE,
-- SECURITY DEFINER, sem UPDATE/DELETE), não toca dado de cliente. Faixa de segundos do code-desenvolvedor-3 (:35).

CREATE OR REPLACE FUNCTION public.fn_inadimplentes_por_status(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atrasadas jsonb;
  v_andamento jsonb;
  v_resolvidas jsonb;
BEGIN
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'total_valor', COALESCE(SUM(er.valor), 0),
    'agrupado_cliente', COALESCE((
      SELECT jsonb_agg(cliente_data) FROM (
        SELECT jsonb_build_object(
          'cliente_id', MAX(er.cliente_id::text)::uuid,
          -- nome do cadastro; se não houver, o nome gravado no título; nunca "(sem nome)".
          'cliente_nome', COALESCE(MAX(cli.nome_fantasia), MAX(cli.razao_social), NULLIF(TRIM(MAX(er.cliente_nome)), ''), 'Cliente sem cadastro'),
          'cliente_cpf_cnpj', COALESCE(MAX(cli.cpf_cnpj), MAX(cli.cnpj_cpf)),
          'cliente_telefone', MAX(cli.telefone),
          'cliente_celular', MAX(cli.celular),
          'cliente_whatsapp', MAX(cli.whatsapp),
          'cliente_email', MAX(cli.email),
          'qtd_contas', COUNT(er.id),
          'total_valor', SUM(er.valor),
          'contas', jsonb_agg(jsonb_build_object(
            'id', er.id,
            'descricao', er.descricao,
            'vencimento', er.data_vencimento,
            'valor', er.valor,
            'dias_atraso', (CURRENT_DATE - er.data_vencimento)
          ) ORDER BY er.data_vencimento)
        ) AS cliente_data
        FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
        LEFT JOIN erp_clientes cli ON cli.id = er.cliente_id
        WHERE er.company_id = p_company_id
          AND er.data_vencimento < CURRENT_DATE
          AND er.status NOT IN ('pago', 'recebido', 'cancelado')
          AND COALESCE(er.em_renegociacao, false) = false
        -- com cadastro: agrupa por cliente_id; sem cadastro: agrupa pelo nome do título (cada um no seu grupo).
        GROUP BY COALESCE(er.cliente_id::text, 'nome:' || lower(trim(COALESCE(er.cliente_nome, ''))))
      ) sub
    ), '[]'::jsonb)
  ) INTO v_atrasadas
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.data_vencimento < CURRENT_DATE
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND COALESCE(er.em_renegociacao, false) = false;

  SELECT jsonb_build_object('count', COUNT(*), 'total_valor', COALESCE(SUM(er.valor), 0))
  INTO v_andamento
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.data_vencimento < CURRENT_DATE
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND COALESCE(er.em_renegociacao, false) = true;

  SELECT jsonb_build_object('count', COUNT(*), 'total_valor', COALESCE(SUM(er.valor_pago), 0))
  INTO v_resolvidas
  FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id
    AND er.status IN ('pago', 'recebido')
    AND er.data_pagamento > er.data_vencimento
    AND er.data_pagamento > CURRENT_DATE - INTERVAL '90 days';

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'atrasadas', v_atrasadas,
    'em_andamento', v_andamento,
    'resolvidas', v_resolvidas
  );
END;
$function$;

-- Guarda da SECURITY DEFINER (check_fn_guards): REVOKE de PUBLIC/anon + GRANT explícitos.
-- Os grants vivos já são só authenticated/service_role/postgres; isto só torna explícito e passa o gate.
REVOKE ALL ON FUNCTION public.fn_inadimplentes_por_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_inadimplentes_por_status(uuid) TO authenticated, service_role;

-- RD-95: "?" (AjudaCampo) nas abas, no TOTAL ATRASADO, no ordenador e na ação por linha. Aditivo, idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/inadimplentes', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.inadimplentes.abas', 'Navegação', 'Atrasadas · Em andamento · Resolvidas',
  'Nada a preencher: são os três estados da cobrança. Atrasadas = vencidas e não pagas; Em andamento = em renegociação; Resolvidas = quitadas nos últimos 90 dias (pagas após o vencimento).',
  'Separa o que precisa de ação agora (Atrasadas) do que já está encaminhado, para você focar a cobrança.',
  'Uma conta vencida que o cliente prometeu pagar vai para "Em andamento" quando você a renegocia.',
  'Procurar uma conta já paga na aba Atrasadas: contas quitadas saem de Atrasadas e vão para Resolvidas.', 1),
 ('ge.inadimplentes.total_atrasado', 'Indicadores', 'Total atrasado',
  'Nada a preencher: é a soma, em reais, de todas as contas a receber vencidas e ainda não pagas (não em renegociação).',
  'Mostra o tamanho do que está em atraso — o foco da cobrança. Some por cliente logo abaixo.',
  'Se há 24 contas vencidas somando R$ 38.000,00, o indicador mostra R$ 38.000,00.',
  'Confundir com o total a receber: aqui entram SÓ as já vencidas, não as que ainda vão vencer.', 2),
 ('ge.inadimplentes.ordenar', 'Lista', 'Ordenar (maior valor / maior atraso)',
  'Escolha a ordem dos clientes na lista: por maior valor devido ou pelo maior número de dias em atraso.',
  'Ajuda a priorizar a cobrança — pelo que mais pesa no caixa ou pelo que está mais antigo.',
  'Escolha "Maior atraso" para falar primeiro com quem está devendo há mais tempo.',
  'Achar que muda os valores: a ordem só reorganiza a lista; os valores e a quantidade de contas não mudam.', 3),
 ('ge.inadimplentes.acao', 'Ações', 'Marcar pago / Renegociar',
  'Nada a preencher: "Marcar pago" baixa a conta na conta bancária padrão; "Renegociar" muda o vencimento e marca como em andamento.',
  'Resolve a cobrança sem sair da tela: ou registra o recebimento, ou combina um novo prazo.',
  'O cliente pagou hoje: use "Marcar pago". Ele pediu mais 30 dias: use "Renegociar".',
  'Marcar pago uma conta que ainda não entrou: só marque o que de fato foi recebido, senão o caixa fica errado.', 4)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado da tela.
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_receber_efetivo','erp_receber','erp_banco_contas']::text[],
       rpcs_chamadas   = ARRAY['fn_inadimplentes_por_status','fn_renegociar_inadimplencia','fn_baixar_pagamento_em_massa','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/financeiro/inadimplentes';
