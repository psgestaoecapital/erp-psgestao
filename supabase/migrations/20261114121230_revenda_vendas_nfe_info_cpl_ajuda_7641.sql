-- Revenda · Vendas · /dashboard/revenda/vendas
-- Chamado #7641 (etapa 2) · Code: rodrigo-code
--
-- RD-95: o card de conferência da NF-e (aberto ao clicar em "Emitir NF-e") tem um campo editável
-- de "Informações complementares" — ganha o "?". Demais dados do card são de conferência (leitura),
-- cobertos pelo "?" do botão "Emitir NF-e" (revenda.vendas.emitir_nfe, já existente).
-- Idempotente (ON CONFLICT (chave)). Metadado de ajuda — NÃO toca dado de cliente, função, RLS
-- nem regra fiscal/financeira. Aditiva. Faixa de segundos do rodrigo-code (:30), acima da main.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('revenda.vendas.nfe_info_complementares','/dashboard/revenda/vendas','Venda e entrega','Informações complementares',
   'Texto livre que aparece na NF-e, em "Informações complementares". Já vem preenchido com o que o sistema monta (observação do pedido, Simples/crédito e o valor aproximado dos tributos da Lei 12.741). Você pode ajustar antes de emitir.',
   'Permite conferir e, se precisar, completar o texto que sai impresso na nota (DANFE), sem mudar a regra de cálculo. É o único campo editável do card de conferência; os demais dados são só para conferência antes de enviar à SEFAZ.',
   'Acrescentar "Veículo vendido no estado em que se encontra" ao texto que o sistema já montou.',
   'Passar do limite de caracteres do campo: o contador fica vermelho e a nota não sai. Reduza o texto antes de confirmar.',
   'revenda', 51, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
