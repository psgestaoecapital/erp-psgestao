-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — F1 (fatia): "Sugerir campos com IA".
-- Esta migration é ADITIVA e idempotente: cadastra apenas a chave de ajuda RD-95 do novo
-- botão "Sugerir campos com IA" da aba Modelos (/dashboard/contratos). Nenhuma função, RLS,
-- tabela ou dado de cliente é tocado — só uma linha de catálogo de ajuda (erp_ajuda_campo).
--
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'ge.contrato.modelo.sugerir_ia',
  '/dashboard/contratos',
  'Modelos de contrato',
  'Sugerir campos com IA',
  'Cole ou escreva o texto do contrato e clique no botão. O sistema lê o texto e propõe quais partes viram campos variáveis (ex.: nome do cliente, valor, datas), já no formato {{campo}}.',
  'Acelera a criação do modelo: em vez de marcar cada {{campo}} à mão, a sugestão identifica os dados que mudam a cada contrato. Você confere e aplica — nada é salvo sem a sua confirmação.',
  'Texto "A CONTRATANTE Padaria do Zé, CNPJ 12.345.678/0001-90, pelo valor de R$ 1.500,00" → sugestão: "A CONTRATANTE {{cliente_nome}}, CNPJ {{cliente_cnpj}}, pelo valor de {{valor_mensal}}".',
  'Esperar que a IA invente dados: ela só marca os campos no seu texto. Se a sugestão não aparecer (IA indisponível), marque os campos manualmente pelos botões de campos variáveis — o resultado é o mesmo.',
  'gestao_empresarial',
  8,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
