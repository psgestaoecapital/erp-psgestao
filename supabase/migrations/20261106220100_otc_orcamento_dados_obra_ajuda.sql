-- #3862/#3863 etapa 1 (FC Pisos / FCR) · "?" do bloco "Dados da obra" no orçamento já salvo (RD-95).
-- Aditiva e idempotente: catálogo global de ajuda, sem dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES (
  'otc.orcamento.dados_obra',
  '/dashboard/commerce/otc',
  'Orçamento',
  'gestao_empresarial',
  'Dados da obra (nota fiscal)',
  'Escolha a obra já cadastrada ou informe o endereço (rua, número, bairro, CEP e município). O CNO é opcional.',
  'Fica gravado no orçamento e a nota de serviço de obra já abre com esses dados, sem pedir de novo ao faturar. Aparece só em orçamento aberto com serviço de construção civil.',
  'Rua das Palmeiras, 120, Centro, CEP 88000-000, Paraíso/SC.',
  'Deixar sem número ou sem município: a prefeitura recusa a nota de obra com endereço incompleto.',
  0
)
ON CONFLICT (chave) DO NOTHING;
