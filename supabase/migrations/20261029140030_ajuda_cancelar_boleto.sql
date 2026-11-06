-- "?" da ação Cancelar boleto (Receitas a Receber). Só dado de ajuda, aditivo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'financeiro.receber.cancelar_boleto', 'Receitas a Receber', 'Cancelar boleto',
 'Clique quando o cliente pagou por outro meio (Pix, dinheiro...) e o boleto não deve mais ser pago. O sistema pede confirmação antes.',
 'Manda a baixa ao banco para o boleto deixar de valer. O título continua em aberto, para você dar baixa pelo pagamento real ou gerar novo boleto.',
 'Cliente pagou por Pix: cancele o boleto e depois baixe o título.',
 'Achar que cancela o título: só o boleto é cancelado, e a ação não pode ser desfeita no banco.',
 1, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
