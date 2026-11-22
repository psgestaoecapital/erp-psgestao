-- Onda C-1 · V31 (CEO 20/11): aba "Biblioteca padrão PS" (só leitura) no Catálogo de Serviços do Hub.
-- RD-95: cada campo/filtro/ação novo da aba tem "?". Aqui semeamos as chaves de ajuda (aditivo, idempotente).
-- Nada de dado de cliente; só catálogo de ajuda. Sem RLS nova (a tabela já é lida por fn_ajuda_campo_listar).

insert into public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
values
  (
    'projetos.catalogo.biblioteca.busca',
    '/dashboard/projetos/catalogo',
    'Biblioteca padrão PS',
    'Buscar na biblioteca',
    'Parte da etapa, da subetapa, do código ou da descrição do serviço de referência.',
    'Filtra na hora a lista de serviços padrão da PS para você achar a referência que precisa.',
    'contrapiso',
    'Procurar aqui por serviço do SEU catálogo; esta aba mostra só os serviços de referência da PS.',
    'projetos', 10, 1, 'publicado'
  ),
  (
    'projetos.catalogo.biblioteca.filtro_etapa',
    '/dashboard/projetos/catalogo',
    'Biblioteca padrão PS',
    'Etapa',
    'Escolha uma etapa da obra para ver só os serviços de referência daquela etapa.',
    'Restringe a lista a uma etapa (ex.: fundações, alvenaria, pintura) para comparar os serviços dela.',
    'Pisos e revestimentos',
    'Esperar que a etapa mude os valores; ela só filtra quais serviços aparecem.',
    'projetos', 20, 1, 'publicado'
  ),
  (
    'projetos.catalogo.biblioteca.usar',
    '/dashboard/projetos/catalogo',
    'Biblioteca padrão PS',
    'Usar este serviço',
    'Clique para copiar o serviço de referência para o catálogo da sua empresa.',
    'Cria (ou reaproveita) o serviço no seu catálogo com os custos de referência; depois você ajusta o custo à sua realidade. Não altera a biblioteca padrão.',
    'Usar "Contrapiso desempenado" e ajustar o custo de material da sua obra.',
    'Clicar várias vezes achando que duplica: o serviço é copiado uma vez só e o clique seguinte abre o mesmo serviço.',
    'projetos', 30, 1, 'publicado'
  )
on conflict (chave) do nothing;
