-- RD-95 (#5452 · F1c): o botão "Subir modelo" passou a aceitar Word (.docx), além de PDF
-- (front na PR do F1c, extração no navegador via jszip). O texto de ajuda da chave
-- ge.contrato.modelo.subir_arquivo ainda dizia "só PDF / salve o Word como PDF antes" — ficou
-- desatualizado e contraditório com a tela. Aqui só o CATÁLOGO DE AJUDA é atualizado para refletir
-- o comportamento novo. Aditiva e idempotente (INSERT ... ON CONFLICT (chave) DO UPDATE).
-- Núcleo não tocado; nenhum dado de cliente. RD-38: 1 linha afetada (a chave já existe).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('ge.contrato.modelo.subir_arquivo', '/dashboard/contratos', 'Modelos de contrato', 'Subir modelo (PDF ou Word)', 'gestao_empresarial', 9,
   'Selecione o arquivo do contrato que você já usa — PDF ou Word (.docx). O sistema lê o texto do arquivo, no próprio navegador, e preenche o campo "Texto do modelo" com o conteúdo — pronto para você marcar os campos variáveis.',
   'Evita digitar de novo um contrato que você já tem pronto: suba o PDF ou o Word, confira o texto extraído e use "Sugerir campos com IA" para marcar o que muda a cada contrato. Nada é enviado para fora nem é salvo até você clicar em "Salvar".',
   'Word (.docx) do "Contrato de prestação de serviços de marketing" → o texto aparece no editor; depois você aplica os campos {{cliente_nome}}, {{valor_mensal}}, {{data_inicio}}.',
   'PDF digitalizado (foto/escaneado) não tem texto selecionável — nesses casos a extração vem vazia e o sistema avisa para colar o texto à mão. Word antigo (.doc) não é lido direto: abra no Word e salve como .docx (ou PDF) antes de subir.')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, atualizado_em = now();
