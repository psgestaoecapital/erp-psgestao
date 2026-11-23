-- Hub · Onda C-2 · tela 334 (importador xlsx do orçamento por EAP) — metadados da TELA.
-- Registra a rota no system_screens (RD-98 origem do dado) e o texto de ajuda RD-95 "?" do campo
-- de upload. Aditivo e idempotente (ON CONFLICT). Não cria/altera estrutura de dados.
-- Backend das RPCs: migration 20261124010045 (fn_projetos_orcamento_eap_importar[_validar]).
-- Code: desenvolvedor_4_g

-- 1) system_screens: a tela de importação existe e consome as RPCs de prévia/import.
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, rpcs_chamadas, auditavel_robo, prioridade_monitoramento)
VALUES (
  gen_random_uuid(),
  '/dashboard/projetos/obras/[id]/orcamento/importar',
  'hub_construcao',
  'projetos_obras',
  'Importar orçamento por EAP',
  'Lê a planilha (.xlsx) do cliente no navegador, autodetecta as colunas (código EAP, descrição, unidade, quantidade, material, mão de obra, local), mostra a prévia com validação e grava os itens do orçamento (idempotente por hash do arquivo). Só gravação por RPC.',
  'parcial',
  ARRAY['fn_projetos_orcamento_eap_importar_validar','fn_projetos_orcamento_eap_importar'],
  true,
  'media'
)
ON CONFLICT (rota) DO UPDATE SET
  rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  modulo        = EXCLUDED.modulo,
  area          = EXCLUDED.area,
  titulo        = EXCLUDED.titulo,
  atualizado_em = now();

-- 2) Ajuda de campo (RD-95): o campo de upload da planilha.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.importar_arquivo','/dashboard/projetos/obras/[id]/orcamento/importar','Importar orçamento','Planilha do orçamento (.xlsx)','O arquivo Excel com os itens do orçamento: uma coluna de código (EAP), descrição, unidade, quantidade, custo de material e de mão de obra, e o local quando houver.','Traz o orçamento inteiro para dentro da obra sem redigitar: você confere a prévia e confirma; os itens entram no orçamento por EAP.','Planilha com as etapas 1, 1.1, 1.2… e os serviços com quantidade e custo.','Enviar a planilha com o código numérico (ex.: 23,10 vira 23,1 e perde o zero) — mantenha o código como texto e confira na prévia.','projetos',10,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  status          = 'publicado',
  atualizado_em   = now();
