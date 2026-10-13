-- Estância Umuarama (636af107-f11f-4f0c-8aaa-3fd3d0ffdf38) — contas mistas + de-para completo.
-- Fazenda mista (pecuária + soja arrendada). Reclassifica os lançamentos legados (categoria em texto
-- livre / códigos Omie) para o plano próprio de 35 contas (migration 20260923360000), adiciona 4 contas
-- de insumo de pastagem, inativa o grupo de lavoura (soja é arrendada a terceiros — recebida em produto)
-- e renomeia 1.02.
--
-- Auditoria (RD-38) sobre 660 a pagar + 33 a receber, lendo fornecedor e descrição de cada pendente.
-- Provado em rollback (impersonação não precisa — roda como o runner): soma de pagar e de receber
-- IDÊNTICA antes e depois (só muda categoria); CONF1 (fora do plano)=ZERO; CONF2 (em totalizador)=ZERO;
-- 1.02 com as 4 vendas de soja (R$ 1.096.773,66) intactas.
--
-- NÃO apaga a duplicata RPE (66 linhas, R$ 69.909,93 × 2) — entregue ao CEO à parte para decidir a série.
-- Moeda: reais. RD-52 (arquivo=ledger), assunto único. Não cria função → sem gate fn-guards.

-- PARTE 4 · espelho ANTES de qualquer UPDATE (693 linhas: 660 pagar + 33 receber)
CREATE TABLE IF NOT EXISTS public.bkp_umuarama_categoria_20260923 AS
SELECT 'pagar'::text AS origem, id, categoria FROM public.erp_pagar
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'
UNION ALL
SELECT 'receber', id, categoria FROM public.erp_receber
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38';

-- PARTE 2 · contas que faltam — fazenda mista usa insumo agrícola no pasto (rodar ANTES da Parte 6:
-- o UPDATE do Calmax aponta para 2.11).
INSERT INTO public.erp_plano_contas
  (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, is_totalizador, ativo)
VALUES
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.10','Defensivos de pastagem','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.11','Fertilizantes e corretivos de pastagem','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.12','Sementes de pastagem','custo','custo','2',2,false,true),
 ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38','2.13','Servicos de terceiros na pecuaria','custo','custo','2',2,false,true);

-- PARTE 3 · soja é arrendada → grupo da lavoura não tem função: INATIVAR (nunca apagar). Renomear 1.02.
UPDATE public.erp_plano_contas SET ativo=false
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'
   AND codigo IN ('3','3.01','3.02','3.03','3.04','3.05');

UPDATE public.erp_plano_contas
   SET descricao='Venda de soja recebida por arrendamento'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND codigo='1.02';

-- PARTE 5 · de-para das contas a pagar (categoria em texto/legado → código do plano)
UPDATE public.erp_pagar p SET categoria = m.destino
FROM (VALUES
 ('Distribuição de Lucros','6.01'),
 ('9 - Compra de Imobilizado','5.01'),
 ('9 - Investimentos em imobilizado','5.01'),
 ('9 - Construções','5.02'),
 ('9 - Compra de Ferramentas','5.03'),
 ('3 - Advogado','4.02'),
 ('3 - Cartório','4.02'),
 -- Contabilidade/Consultoria têm subconta própria (4.02.04/4.02.05): lançar na filha, não no pai
 -- (senão a filha fica vazia e o pai vira quase-totalizador — mesmo problema do #1734).
 ('3 - Contabilidade','4.02.04'),
 ('3.01.08','4.02.04'),
 ('3 - Consultoria','4.02.05'),
 ('3.01.15','4.02.05'),
 ('4 - Despesas com Pessoal','4.01'),
 ('4 - Salários','4.01'),
 ('4 - Férias (salário e adicional).','4.01'),
 ('4 - Décimo terceiro salário.','4.01'),
 ('4 - Bonificações por desempenho.','4.01'),
 ('3.02.01','4.01'),
 ('3.02.05','4.01'),
 ('3.02.10','4.01'),
 ('3 - Internet','4.03'),
 ('3 - Energia','4.03'),
 ('3 - Limpeza','4.03'),
 ('3 - Confraternização','4.03'),
 ('3 - Despesas administrativas','4.03'),
 ('3 - Manutenção de veículos','4.04'),
 ('3 - IPVA','4.04'),
 ('3 - Licenciamento','4.04'),
 ('3 - Manutenções Diversas','4.05'),
 ('3.01.10','4.05'),
 ('5 - Comissão de Venda','4.06'),
 ('7 - Impostos','4.07'),
 ('7 - IPTU','4.07'),
 ('7 - ICMS','4.07'),
 ('7 - Certificado Digital','4.07'),
 ('3 - Taxas Certificação','4.07'),
 ('3 - Multa','4.07'),
 ('2 - Medicamento','2.02'),
 ('2.04','2.02'),
 ('4 - Médico Veterinário Tercerizado','2.02'),
 ('3 - Diarista','2.04'),
 ('3.02.11','2.04'),
 ('3 - Manutenção de pastagens','2.05'),
 ('3 -  Combustível','2.09'),
 ('3.01.14','2.09'),
 ('3 - Manuteção de Equipamentos','2.09'),
 ('2.03.02','2.09')
) AS m(origem, destino)
WHERE p.company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND p.categoria = m.origem;

-- PARTE 6 · os pendentes resolvidos por fornecedor e descrição (RPE antes das varreduras de '2 -...')
UPDATE public.erp_pagar SET categoria='2.03'  -- Inseminação (RPE) -> Reprodução e genética
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND fornecedor_nome='RPE Reprodução Bovina';

UPDATE public.erp_pagar SET categoria='2.11'  -- Calcário p/ reforma de pasto -> corretivos de PASTAGEM
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND fornecedor_nome='Calmax';

UPDATE public.erp_pagar SET categoria='2.02'  -- Agrocampo medicamento -> sanidade
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND fornecedor_nome='Agrocampo' AND descricao ILIKE '%medicamento%';
UPDATE public.erp_pagar SET categoria='2.01'  -- Agrocampo suplemento/material -> alimentação
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND fornecedor_nome='Agrocampo' AND categoria <> '2.02';

UPDATE public.erp_pagar SET categoria='2.02'  -- Subcontratação: vacinador -> sanidade
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='2 - Subcontratação' AND descricao ILIKE '%vascinador%';
UPDATE public.erp_pagar SET categoria='2.09'  -- Subcontratação: frete de trator -> máquinas
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='2 - Subcontratação' AND descricao ILIKE '%trator%';

UPDATE public.erp_pagar SET categoria='2.02'  -- medicamento/vacinador sem fornecedor -> sanidade
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='2 - Custo das Vendas'
   AND (descricao ILIKE '%medicamento%' OR descricao ILIKE '%vascinador%');

UPDATE public.erp_pagar SET categoria='5.02'  -- Casa dos Carneiros -> Construções e benfeitorias
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND descricao ILIKE '%Casa dos Carneiros%';

-- PARTE 6b · correções do CEO sobre as 2 sobras (rodam DEPOIS da Parte 6):
-- SENACSA = órgão sanitário oficial do Paraguai; documento de gado é custo DIRETO da pecuária (não cartório).
UPDATE public.erp_pagar SET categoria='2.02'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='3.01.16';
-- Joseleno = comissão sobre venda de bezerros -> Comercial.
UPDATE public.erp_pagar SET categoria='4.06'
 WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND categoria='3.03.01';

-- PARTE 7 · de-para das contas a receber
UPDATE public.erp_receber r SET categoria = m.destino
FROM (VALUES
 ('Soja','1.02'),
 ('Vaca Gorda','1.01'),
 ('Venda de gado','1.01'),
 ('Novilha','1.01'),
 ('Bezerro Macho','1.01'),
 ('Arrendamento de Pasto','1.03'),
 ('Receitas Nao Operacionais','1.04')
) AS m(origem, destino)
WHERE r.company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38' AND r.categoria = m.origem;
