-- RD-98 p3 (origem do dado / "entrega só conta se o usuário a enxerga"): registra em system_screens
-- as 5 sub-rotas da obra do Hub que estavam FORA do registro, apesar de jornada funcional já em produção.
-- Descoberta PDCA auditor_pdca_1 (08/11, main da83045, prova RD-38): as 5 têm RPCs publicadas, estado vazio
-- que orienta, erro amigável, RD-95 "?" e layout próprio — o único gap concreto, idêntico nas 5, era não
-- estarem em system_screens. Esta migration é ADITIVA e IDEMPOTENTE: só INSERE as linhas que faltam
-- (ON CONFLICT (rota) DO NOTHING — rota é UNIQUE), não altera nenhuma linha existente nem dado de cliente.
--
-- views_consumidas / rpcs_chamadas conferidos no código (page.tsx de cada rota) e as 12 funções conferidas
-- existentes em produção (pg_proc) nesta sessão.

INSERT INTO system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, estado_real, prioridade_monitoramento, modulo, auditavel_robo)
VALUES
  ('dashboard.projetos_obras_id_encerramento',
   '/dashboard/projetos/obras/[id]/encerramento', 'hub_construcao', 'Encerramento da obra',
   'Termo de entrega (rascunho → assinar, imutável), retenção/garantia e documentos da obra (upload e exclusão rastreável).',
   ARRAY['erp_obra_arquivos','projetos_obras']::text[],
   ARRAY['fn_obra_termo_entrega_obter','fn_obra_termo_entrega_registrar','fn_obra_retencao_garantia_obter','fn_obra_retencao_garantia_salvar','fn_obra_arquivo_excluir','fn_ajuda_campo_listar']::text[],
   'parcial', 'media', 'projetos_obras', true),

  ('dashboard.projetos_obras_id_subempreiteiros',
   '/dashboard/projetos/obras/[id]/subempreiteiros', 'hub_construcao', 'Subempreiteiros da obra',
   'Contrato do subempreiteiro (fornecedor da GE) com itens e preços: novo, editar e excluir rastreável; total contratado.',
   ARRAY['erp_fornecedores','projetos_obras']::text[],
   ARRAY['fn_obra_subempreiteiro_contrato_listar','fn_obra_subempreiteiro_contrato_salvar','fn_obra_subempreiteiro_contrato_excluir','fn_ajuda_campo_listar']::text[],
   'parcial', 'media', 'projetos_obras', true),

  ('dashboard.projetos_obras_id_revisoes',
   '/dashboard/projetos/obras/[id]/revisoes', 'hub_construcao', 'Revisões de escopo da obra',
   'Consulta das revisões de escopo da obra (valor anterior × novo, itens, situação); abertura de revisão é fatia sensível separada.',
   ARRAY['projetos_obras']::text[],
   ARRAY['fn_obra_revisao_listar','fn_ajuda_campo_listar']::text[],
   'parcial', 'media', 'projetos_obras', true),

  ('dashboard.projetos_obras_id_linha_do_tempo',
   '/dashboard/projetos/obras/[id]/linha-do-tempo', 'hub_construcao', 'Linha do tempo da obra',
   'Timeline da obra por fase, com lead time entre fases. Só leitura.',
   ARRAY[]::text[],
   ARRAY['fn_obra_linha_do_tempo','fn_ajuda_campo_listar']::text[],
   'parcial', 'media', 'projetos_obras', true),

  ('dashboard.projetos_obras_id_relatorio',
   '/dashboard/projetos/obras/[id]/relatorio', 'hub_construcao', 'Relatório ao cliente da obra',
   'Relatório ao cliente da obra (avanço, medições, documentos) com imprimir/PDF. Só leitura.',
   ARRAY[]::text[],
   ARRAY['fn_obra_relatorio_cliente','fn_ajuda_campo_listar']::text[],
   'parcial', 'media', 'projetos_obras', true)
ON CONFLICT (rota) DO NOTHING;
