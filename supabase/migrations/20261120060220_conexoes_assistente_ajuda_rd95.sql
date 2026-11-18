-- Financeiro · Conexões Bancárias · tela "Assistente de Conexão Bancária"
-- (/dashboard/financeiro/conexoes-bancarias/assistente) — ajuda de campo "?" (RD-95).
-- Code: jordana-code.
--
-- Contexto: o Assistente guia a conexão de um banco em 4 fases (solicitar → receber →
-- testar → produção). Os dois únicos campos da tela — o seletor de banco do cabeçalho e
-- os campos ILUSTRATIVOS (modelo) da fase "Receber credenciais" — ainda não tinham o "?"
-- obrigatório (RD-95). Esta fatia semeia só as chaves de ajuda — NÃO cria/altera tabela,
-- função, RLS nem dado de cliente.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é
-- catálogo global de ajuda (sem company_id, sem dado pessoal). Não altera linha existente.
-- RD-100: texto em marca própria, sem nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('conexoes.assistente.banco', '/dashboard/financeiro/conexoes-bancarias/assistente', 'Cabeçalho', 'gestao_empresarial',
   'Banco',
   'Escolha o banco cuja conexão você quer configurar. O assistente se adapta a cada banco: mostra os campos que aquele banco pede, o roteiro para solicitar as APIs e os degraus de teste disponíveis.',
   'Define todo o roteiro da tela — a lista para mandar ao banco, as credenciais esperadas e a escada de teste são montadas a partir do banco escolhido.',
   'Selecione o banco com o qual a empresa tem conta de cobrança para ver o passo a passo daquele banco.',
   'Esperar ver os campos de outro banco: cada banco pede credenciais diferentes; troque o banco no seletor para ver o roteiro certo.', 1),

  ('conexoes.assistente.campo_modelo', '/dashboard/financeiro/conexoes-bancarias/assistente', 'Receber credenciais', 'gestao_empresarial',
   'Campo de credencial (modelo)',
   'Aqui é só um MODELO do que pedir ao banco — os campos ficam propositalmente desabilitados. Não preencha por aqui: use o botão "Preencher / editar credenciais" para digitar e salvar com segurança (cofre).',
   'Serve de referência do que cada banco exige (ex.: chave da API, carteira, certificado). O valor real é guardado no cofre pela tela Conectar, nunca digitado nesta prévia.',
   'Veja o rótulo e o exemplo de cada credencial para saber o que solicitar ao gerente; depois preencha de verdade na tela Conectar.',
   'Tentar digitar a credencial aqui: este campo é só ilustrativo. O preenchimento seguro é na tela Conectar.', 2)
ON CONFLICT (chave) DO NOTHING;
