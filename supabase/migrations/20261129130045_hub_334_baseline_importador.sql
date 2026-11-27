-- Reconciliação de baseline (RD-38) da tela §334 "Importar orçamento por EAP (.xlsx)".
-- A tela foi publicada na #5812 (rota /dashboard/projetos/obras/[id]/orcamento/importar),
-- consumindo fn_projetos_orcamento_eap_importar_validar / _importar (ambas em produção).
-- Marca SÓ o que está PROVADO no código mergeado e nas RPCs vivas; o resto fica 'ausente'.
-- Data-only, aditiva, idempotente (UPDATE por id da linha do blueprint).

-- (atendido) Relatório do que não foi lido ou ficou ambíguo (códigos repetidos etc.):
--   _validar devolve, por linha, os 'motivos' (inclui 'código EAP duplicado no arquivo');
--   _importar devolve 'detalhe' com erros/ignorados; a prévia mostra válidos × com erro.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='PR #5812 · /dashboard/projetos/obras/[id]/orcamento/importar — fn_..._importar_validar: motivos por linha (código EAP vazio/duplicado, descrição/unidade/qtd/custos inválidos); fn_..._importar: detalhe de erros/ignorados; prévia mostra válidos × com erro.'
 WHERE id='7079fa42-efbb-4c28-98c9-543c33adedb0';

-- (parcial) Assistente de importação: a #5812 entrega 3 passos (enviar → prévia/validar → confirmar)
--   com autodetecção de colunas, idempotência por hash. Falta o mapeamento manual de colunas e o
--   vínculo à biblioteca padrão (333) — explicitamente fora de escopo na #5812.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='PR #5812 · rota importar — 3 passos (upload → prévia/validar sem gravar → confirmar), autodetecção de cabeçalho/colunas (SheetJS), idempotente por SHA-256. Falta: mapeamento manual de colunas e vínculo à biblioteca 333.'
 WHERE id='3247e640-0237-450d-936a-0dbcaf546b07';

-- (parcial) Reconhecer o cabeçalho: mapearColunas acha a linha de cabeçalho e os índices por regex
--   (código/EAP/item, descrição/serviço/insumo, unidade, qtd, material, mão de obra, local). Mecanismo
--   presente; sinônimo "DISCRIMINAÇÃO" ainda não coberto pela regex de descrição → parcial.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='PR #5812 · rota importar — mapearColunas detecta a linha de cabeçalho (até 15 linhas) e mapeia colunas por regex (cód/EAP/item, descri/serviço/insumo, unidade, qtd, material, mão de obra, local). Falta cobrir o rótulo "DISCRIMINAÇÃO".'
 WHERE id='6ba346e1-8f6d-410a-961c-c6c31f35de77';

-- (parcial) Ler os valores calculados (não as fórmulas) e conferir o total: a tela lê o .xlsx com
--   raw:false (valores calculados, não fórmulas). Falta conferir soma importada × total declarado da
--   planilha → parcial.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='PR #5812 · rota importar — leitura do .xlsx com SheetJS raw:false (valores calculados, não fórmulas). Falta: conferência da soma importada contra o total declarado da planilha.'
 WHERE id='0d21b7e9-eead-40a9-aadf-b33718a16b3c';
