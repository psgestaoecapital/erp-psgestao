-- Plano gerencial da FC Pisos (nascimento). SPEC CEO 22/09. RD-52.
-- Empresa: FC PISOS E REVESTIMENTOS INDUSTRIAIS LTDA (b202b50f-37cb-462e-accf-126869de49f0).
-- Decisões do CEO: (1) investimento, amortização de principal e retirada de lucros ficam DENTRO
-- do resultado (3.09/3.10/3.11); (2) juros separados do principal (juros em 4.01, principal em 3.10);
-- (3) plano só de resultado e caixa — a árvore patrimonial é confirmada depois com a contabilidade.
-- Fora do escopo: os vínculos com as 144 contas contábeis (vínculo é imutável e só se amarra depois
-- da validação do Ervim). O deploy-migrations roda cada migration em transação própria.

-- 1) Sai a cópia do template (idêntica ao global, que permanece; 0 vínculos, sem FK dependente).
DELETE FROM public.erp_plano_contas
 WHERE company_id = 'b202b50f-37cb-462e-accf-126869de49f0';

-- 2) Nasce o plano da FC Pisos (34 contas: resultado + caixa).
INSERT INTO public.erp_plano_contas
  (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, is_totalizador, ativo)
VALUES
 ('b202b50f-37cb-462e-accf-126869de49f0','1','RECEITA','receita','receita',NULL,1,true,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','1.01','Serviços de pisos e revestimentos','receita','receita','1',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','1.02','Serviços com ISS substituído','receita','receita','1',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','1.03','Serviços e produtos ao exterior','receita','receita','1',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','1.04','Venda de materiais','receita','receita','1',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','1.05','(-) Deduções da receita','receita','receita','1',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','1.06','Outras receitas operacionais','receita','receita','1',2,false,true),

 ('b202b50f-37cb-462e-accf-126869de49f0','2','CUSTO DAS OBRAS','custo','custo',NULL,1,true,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.01','Materiais aplicados em obra','custo','custo','2',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.02','Mão de obra de campo','custo','custo','2',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.03','Benefícios e proteção da equipe','custo','custo','2',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.04','Subempreitada e serviços de terceiros','custo','custo','2',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.05','Mobilização e permanência','custo','custo','2',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.06','Veículos e equipamentos de obra','custo','custo','2',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','2.07','Logística e resíduos','custo','custo','2',2,false,true),

 ('b202b50f-37cb-462e-accf-126869de49f0','3','DESPESAS','despesa','despesa',NULL,1,true,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.01','Instalações e utilidades','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.02','Administrativo e expediente','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.03','Sócios e direção','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.04','Serviços profissionais','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.05','Comercial e marketing','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.06','Tributos da estrutura','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.07','Depreciação e amortização','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.08','Perdas','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.09','Investimentos em ativo','despesa','investimento','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.10','Amortização de principal de financiamento','despesa','despesa','3',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','3.11','Retirada de lucros dos sócios','despesa','despesa','3',2,false,true),

 ('b202b50f-37cb-462e-accf-126869de49f0','4','RESULTADO FINANCEIRO','financeiro','financeiro',NULL,1,true,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','4.01','Juros de financiamento e de mora','financeiro','financeiro','4',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','4.02','Tarifas e meios de pagamento','financeiro','financeiro','4',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','4.03','Receitas financeiras','financeiro','financeiro','4',2,false,true),

 ('b202b50f-37cb-462e-accf-126869de49f0','5','ADIANTAMENTOS','despesa','despesa',NULL,1,true,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','5.01','Adiantamentos a colaboradores e viagens','despesa','despesa','5',2,false,true),
 ('b202b50f-37cb-462e-accf-126869de49f0','5.02','Reembolso de adiantamentos','despesa','despesa','5',2,false,true);

-- 3) Liga a isolação do #1715 SÓ para a FC (as demais empresas ficam em false).
UPDATE public.companies
   SET plano_contas_proprio = true
 WHERE id = 'b202b50f-37cb-462e-accf-126869de49f0';
