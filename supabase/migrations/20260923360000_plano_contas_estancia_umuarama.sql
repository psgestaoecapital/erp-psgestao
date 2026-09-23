-- Plano de contas próprio da ESTANCIA UMUARAMA E.A.S. (Agro) — 636af107-f11f-4f0c-8aaa-3fd3d0ffdf38.
-- Derivado das 50 categorias em uso (660 contas a pagar + 33 a receber). Mesmo padrão da FC Pisos (#1718):
-- apaga a cópia do template, cria o plano próprio (35 contas: 6 totalizadores + 29 subcontas), liga plano_contas_proprio.
-- RD-52 (arquivo = ledger) · RD-38 (provado em rollback). Roda em transação do runner.

DELETE FROM public.erp_plano_contas
 WHERE company_id = '636af107-f11f-4f0c-8aaa-3fd3d0ffdf38';

INSERT INTO public.erp_plano_contas
  (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, is_totalizador, ativo)
VALUES
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1','RECEITAS','receita','receita',NULL,1,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.01','Venda de gado','receita','receita','1',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.02','Venda de soja','receita','receita','1',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.03','Arrendamento de pasto','receita','receita','1',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','1.04','Outras receitas','receita','receita','1',2,false,true),

 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2','CUSTO DA PECUARIA','custo','custo',NULL,1,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.01','Alimentacao do rebanho','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.02','Sanidade animal','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.03','Reproducao e genetica','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.04','Mao de obra do campo','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.05','Pastagem e cercas','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.06','Compra de animais','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.07','Frete e transporte de animais','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.08','Insumos e materiais de producao','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.09','Maquinas e combustivel do campo','custo','custo','2',2,false,true),

 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','3','CUSTO DA LAVOURA','custo','custo',NULL,1,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','3.01','Sementes e mudas','custo','custo','3',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','3.02','Fertilizantes e corretivos','custo','custo','3',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','3.03','Defensivos','custo','custo','3',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','3.04','Operacoes de plantio e colheita','custo','custo','3',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','3.05','Frete e armazenagem de graos','custo','custo','3',2,false,true),

 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4','DESPESAS','despesa','despesa',NULL,1,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.01','Pessoal administrativo','despesa','despesa','4',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.02','Servicos profissionais','despesa','despesa','4',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.03','Estrutura e utilidades','despesa','despesa','4',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.04','Veiculos','despesa','despesa','4',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.05','Manutencoes diversas','despesa','despesa','4',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.06','Comercial','despesa','despesa','4',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','4.07','Tributos e taxas','despesa','despesa','4',2,false,true),

 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5','INVESTIMENTOS','despesa','investimento',NULL,1,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5.01','Imobilizado','despesa','investimento','5',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5.02','Construcoes e benfeitorias','despesa','investimento','5',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','5.03','Ferramentas e equipamentos','despesa','investimento','5',2,false,true),

 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','6','SOCIOS','despesa','despesa',NULL,1,true,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','6.01','Distribuicao de lucros','despesa','despesa','6',2,false,true);

UPDATE public.companies
   SET plano_contas_proprio = true
 WHERE id = '636af107-f11f-4f0c-8aaa-3fd3d0ffdf38';
