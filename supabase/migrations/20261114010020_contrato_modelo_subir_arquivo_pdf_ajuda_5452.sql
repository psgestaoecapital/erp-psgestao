-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — F1b (fatia): "Subir modelo em PDF".
-- Esta migration é ADITIVA e idempotente: cadastra apenas a chave de ajuda RD-95 do novo
-- botão "Subir modelo (PDF)" da aba Modelos (/dashboard/contratos), que extrai o texto do
-- arquivo direto no navegador (pdfjs-dist, já instalado) e preenche o editor. Nenhuma função,
-- RLS, tabela ou dado de cliente é tocado — só uma linha de catálogo de ajuda (erp_ajuda_campo).
--
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'ge.contrato.modelo.subir_arquivo',
  '/dashboard/contratos',
  'Modelos de contrato',
  'Subir modelo (PDF)',
  'Selecione o arquivo PDF do contrato que você já usa. O sistema lê o texto do arquivo, no próprio navegador, e preenche o campo "Texto do modelo" com o conteúdo — pronto para você marcar os campos variáveis.',
  'Evita digitar de novo um contrato que você já tem pronto: suba o PDF, confira o texto extraído e use "Sugerir campos com IA" para marcar o que muda a cada contrato. Nada é salvo até você clicar em "Salvar".',
  'PDF do "Contrato de prestação de serviços de marketing" → o texto aparece no editor; depois você aplica os campos {{cliente_nome}}, {{valor_mensal}}, {{data_inicio}}.',
  'PDF digitalizado (foto/escaneado) não tem texto selecionável — nesses casos a extração vem vazia e o sistema avisa para colar o texto à mão. Arquivos Word (.doc/.docx): salve como PDF antes de subir.',
  'gestao_empresarial',
  9,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
