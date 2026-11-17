-- Painel de vendas (/dashboard/comercial/meu-painel) — card "Faturamento líquido" (CEO 12/11, apresentação Frioeste).
-- Aditiva e idempotente: só acrescenta a chave de ajuda (RD-95) do novo card da Visão geral. O card em si (page.tsx)
-- calcula bruto − devoluções com dados que o painel já tem (devR); esta migration só garante o "?" com texto do banco.
-- Não toca dado de cliente, não altera objeto existente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('com.painel.faturado_liquido', '/dashboard/comercial/meu-painel', 'Visão geral', 'Faturamento líquido',
   'Nada a preencher. Mostra o faturamento já descontadas as devoluções reais do período.',
   'É o faturamento bruto menos as devoluções reais (tipos T582 e T583) do período. É o número que bate com o relatório do ATAK — o que de fato entrou, depois de tirar o que voltou. O card "Faturamento" ao lado continua mostrando o bruto (antes das devoluções).',
   'Faturou R$ 1.000.000 no bruto e teve R$ 40.000 de devoluções → Faturamento líquido R$ 960.000.',
   'Comparar o faturamento líquido com o bruto de outro relatório: o líquido já tirou as devoluções; compare sempre bruto com bruto e líquido com líquido.',
   'comercial', 2, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
