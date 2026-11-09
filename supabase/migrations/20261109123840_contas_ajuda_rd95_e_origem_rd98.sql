-- PDCA GE /dashboard/contas (aud8 85): RD-95 ("?" em KPIs/filtros/colunas) + RD-98 p3 (origem do dado).
-- Aditiva e idempotente. Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('contas.kpi_receber','/dashboard/contas','Contas','A Receber',
   'Nada a preencher — soma dos títulos a receber em aberto da(s) empresa(s) selecionada(s).',
   'Mostra quanto ainda vai entrar no caixa. O "atrasado" em vermelho destaca o que já venceu.',
   'A Receber R$ 43.470,00 (⚠️ R$ 5.000 atrasado).','—','financeiro',1,1,'publicado'),
  ('contas.kpi_pagar','/dashboard/contas','Contas','A Pagar',
   'Nada a preencher — soma dos títulos a pagar em aberto.',
   'Mostra quanto ainda vai sair do caixa; o "atrasado" destaca contas já vencidas.',
   'A Pagar R$ 2.944,90.','—','financeiro',2,1,'publicado'),
  ('contas.kpi_saldo','/dashboard/contas','Contas','Saldo Projetado',
   'Nada a preencher — A Receber menos A Pagar (dos títulos em aberto).',
   'Sinaliza, de forma rápida, se o previsto fecha positivo (verde) ou negativo (vermelho).',
   'Saldo Projetado R$ 40.525,10.','Confundir com saldo bancário atual: aqui é o PREVISTO dos títulos em aberto.','financeiro',3,1,'publicado'),
  ('contas.kpi_pendentes','/dashboard/contas','Contas','Pendentes / Atrasados',
   'Nada a preencher — quantidade de títulos pendentes e, em vermelho, quantos estão atrasados.',
   'Dá o tamanho da fila de cobrança/pagamento e quanto dela já passou do vencimento.',
   '65 / 21 (65 pendentes, 21 atrasados).','—','financeiro',4,1,'publicado'),
  ('contas.busca','/dashboard/contas','Contas','Busca',
   'Digite parte da descrição, do cliente ou do fornecedor para filtrar a lista.',
   'Acha rápido um título específico sem rolar a lista inteira.',
   'Buscar "energia" para ver as contas de luz.','—','financeiro',5,1,'publicado'),
  ('contas.filtro_tipo','/dashboard/contas','Contas','Filtro por tipo',
   'Escolha entre Todos, Receitas (a receber) ou Despesas (a pagar).',
   'Separa o que entra do que sai, para olhar um lado de cada vez.','Receitas → só os títulos a receber.','—','financeiro',6,1,'publicado'),
  ('contas.filtro_status','/dashboard/contas','Contas','Filtro por situação',
   'Escolha entre Pendentes, Atrasados, Pagos ou Todos.',
   'Foca na situação que você quer tratar agora (ex.: só os atrasados para cobrar).','Atrasados → só o que já venceu e não foi baixado.','—','financeiro',7,1,'publicado'),
  ('contas.col_venc','/dashboard/contas','Contas','Coluna Vencimento',
   'Nada a preencher — data de vencimento do título.',
   'Ordena a urgência: o que vence antes aparece para tratar primeiro.','15/11/2026.','—','financeiro',8,1,'publicado'),
  ('contas.col_descricao','/dashboard/contas','Contas','Coluna Descrição',
   'Nada a preencher — o que é o título (texto do lançamento).',
   'Identifica o lançamento sem abrir o detalhe.','"Energia — novembro".','—','financeiro',9,1,'publicado'),
  ('contas.col_pessoa','/dashboard/contas','Contas','Coluna Cliente / Fornecedor',
   'Nada a preencher — de quem você recebe (cliente) ou para quem paga (fornecedor).',
   'Agrupa mentalmente os títulos por quem está do outro lado.','Fornecedor: "Companhia de Energia".','—','financeiro',10,1,'publicado'),
  ('contas.col_valor','/dashboard/contas','Contas','Coluna Valor',
   'Nada a preencher — valor do título.',
   'Dimensiona o impacto de cada conta no caixa.','R$ 1.250,00.','—','financeiro',11,1,'publicado'),
  ('contas.col_status','/dashboard/contas','Contas','Coluna Status',
   'Nada a preencher — situação do título (pendente, atrasado, pago).',
   'Diz, numa olhada, o que já foi resolvido e o que ainda falta.','Atrasado (vermelho) × Pago (verde).','—','financeiro',12,1,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: registra a origem do dado da tela (estava null).
UPDATE public.system_screens
SET views_consumidas = ARRAY['v_lancamentos_consolidado','erp_banco_contas']::text[],
    rpcs_chamadas = ARRAY['batch_baixa_titulos','batch_cancelar_titulos','batch_alterar_vencimento','fn_ajuda_campo_listar']::text[]
WHERE rota = '/dashboard/contas';
