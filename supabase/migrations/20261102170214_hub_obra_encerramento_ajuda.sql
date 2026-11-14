-- Hub · Gestão de Obras · Encerramento — ajuda de campo ("?") da aba Documentos (RD-95).
-- Seed das chaves de ajuda da tela nova /dashboard/projetos/obras/[id]/encerramento e do link no cockpit.
-- Fonte única lida por fn_ajuda_campo_listar (uma chamada por tela). ADITIVA, idempotente (chave UNIQUE).
-- Linguagem de arquiteto/engenheiro, sem nome de terceiros (RD-100).
-- Code: desenvolvedor_5_g

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  ('projetos.encerramento.aba', '/dashboard/projetos/obras/[id]/encerramento', 'Encerramento da obra', 'hub_projetos',
   'Encerramento da obra',
   'Reúne o que fecha a obra: os documentos finais (termo de entrega, ART/RRT, as built, laudos, fotos) e, nas próximas etapas, o termo assinado e a mudança do status da obra para entregue.',
   'Deixa a prova do encerramento guardada junto da obra — quem entregou, quando e com quais documentos — para auditoria e para o cliente.',
   'Guardar o termo de entrega assinado e o as built ao concluir a obra.',
   'Tratar como lixeira de arquivos: aqui ficam só os documentos que comprovam a entrega da obra.',
   10, 'publicado'),

  ('projetos.encerramento.documentos', '/dashboard/projetos/obras/[id]/encerramento', 'Encerramento da obra', 'hub_projetos',
   'Documentos da obra',
   'Os anexos da obra, organizados por tipo. Cada documento fica em armazenamento privado da obra, acessível só a quem tem acesso à empresa.',
   'Centraliza a papelada da entrega para você achar rápido e enviar ao cliente sem procurar em e-mail ou pasta solta.',
   'Termo de entrega (PDF), ART (PDF), fotos da obra pronta (JPG).',
   'Subir documento de outra obra aqui: cada documento fica amarrado a esta obra.',
   20, 'publicado'),

  ('projetos.encerramento.tipo', '/dashboard/projetos/obras/[id]/encerramento', 'Encerramento da obra', 'hub_projetos',
   'Tipo do documento',
   'Escolha o que o arquivo é antes de anexar: termo de entrega, ART/RRT, as built, laudo, foto, nota/documento ou outro.',
   'O tipo organiza a lista e o filtro, e deixa claro qual papel cada arquivo cumpre no encerramento.',
   'Termo de entrega',
   'Deixar tudo como "Outro": aí o filtro por tipo perde a utilidade.',
   30, 'publicado'),

  ('projetos.encerramento.upload', '/dashboard/projetos/obras/[id]/encerramento', 'Encerramento da obra', 'hub_projetos',
   'Enviar documento',
   'Arraste o arquivo ou clique para escolher. Aceita PDF, JPG, PNG ou WebP, até 10 MB cada.',
   'Guarda o documento no armazenamento privado da obra e registra quem enviou e quando (exclusão rastreável).',
   'Arrastar o PDF do termo de entrega para a área de envio.',
   'Tentar subir arquivo acima de 10 MB ou em formato não aceito: o envio é recusado antes de salvar.',
   40, 'publicado'),

  ('projetos.encerramento.filtro', '/dashboard/projetos/obras/[id]/encerramento', 'Encerramento da obra', 'hub_projetos',
   'Filtrar por tipo',
   'Escolha um tipo para ver só os documentos daquele tipo, ou "Todos" para ver a lista inteira.',
   'Ajuda a achar rápido um documento específico quando a obra acumula muitos anexos.',
   'Filtrar por "ART / RRT" para conferir só as anotações de responsabilidade técnica.',
   'Achar que a lista está vazia quando, na verdade, há um filtro de tipo ativo.',
   50, 'publicado'),

  ('projetos.cockpit.encerramento', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'hub_projetos',
   'Encerramento',
   'Atalho para a aba de encerramento da obra: documentos finais, termo de entrega e, nas próximas etapas, a entrega formal.',
   'Leva direto ao lugar onde se guarda a prova de que a obra foi concluída e entregue.',
   'Abrir o encerramento para anexar o termo de entrega assinado.',
   'Procurar os documentos finais da obra em outras abas: eles ficam no Encerramento.',
   140, 'publicado')
ON CONFLICT (chave) DO NOTHING;
