-- Revenda · Venda · /dashboard/revenda/veiculo
-- Chamado #8162 (etapa 2c) · Code: rodrigo-code
--
-- RD-95: a troca do campo "banco" (texto livre) por SELEÇÃO do banco parceiro cadastrado,
-- no modal de Registrar venda da ficha do veículo, ganha o "?". A rota é passada explicitamente
-- no componente (/dashboard/revenda/veiculo) porque a rota real tem o id do veículo.
-- Idempotente (ON CONFLICT (chave)). Metadado de ajuda — NÃO toca dado de cliente, função,
-- RLS nem regra fiscal/financeira. Aditiva. Faixa de segundos do rodrigo-code (:30), acima da main.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('revenda.venda.banco_parceiro','/dashboard/revenda/veiculo','Recebimentos','Banco (financiamento)',
   'Escolha o banco parceiro que vai financiar o cliente. A lista vem do cadastro de Bancos parceiros (Configuração da garagem). Se a empresa ainda não cadastrou nenhum, o campo segue como texto livre.',
   'Ao escolher o banco e ter o valor financiado informado, o sistema calcula o retorno previsto (% do banco × financiado); o valor fica editável no campo "retorno do banco (receita)". O retorno é a receita de intermediação da garagem.',
   'Banco X Financiamentos (2%) com R$ 50.000 financiados = R$ 1.000 de retorno previsto.',
   'Não achou o banco na lista? Cadastre-o primeiro em Configuração da garagem › Bancos parceiros.',
   'revenda', 50, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
