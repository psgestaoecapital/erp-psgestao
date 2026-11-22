-- =====================================================================
-- Hub · Onda M0 — ajuda RD-95 ("?") dos campos do card "Tipo de empresa no Hub"
-- Rota /dashboard/projetos/configuracoes · componente HubPerfilCard.
-- Catálogo global (sem dado de cliente); idempotente.
-- =====================================================================
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('hub.perfil.modo', '/dashboard/projetos/configuracoes', 'Tipo de empresa',
   'Tipo de empresa no Hub',
   'Escolha como a sua empresa usa o Hub: construtora (obra inteira), prestadora de serviço (uma especialidade), escritório de arquitetura/gestão, ou pessoa física acompanhando a própria obra.',
   'O tipo define só o que aparece no menu do Hub — deixa a navegação enxuta, com as telas que o seu trabalho usa. Nenhum dado é escondido ou apagado; você pode mudar o tipo quando quiser.',
   'Uma empresa que só executa pisos escolhe "Prestadora de serviço" e vê as telas de prestadora, sem Permutas nem Simulador de obra.',
   'Achar que mudar o tipo apaga obras ou orçamentos: não apaga nada — só muda quais telas aparecem no menu.',
   'hub_projetos', 10, 1, 'publicado'),
  ('hub.perfil.ramos', '/dashboard/projetos/configuracoes', 'Tipo de empresa',
   'Especialidades da prestadora',
   'Marque uma ou mais especialidades da sua empresa (piso, gesso, elétrica, hidráulica…). Aparece só quando o tipo é "Prestadora de serviço".',
   'As especialidades definem a biblioteca de serviços e as etapas do orçamento que vêm prontas para você — o conteúdo, não as telas. Piso e elétrica veem as mesmas telas; muda a biblioteca.',
   'Uma gesseira marca "Gesso e drywall" e passa a ver, no catálogo e no orçamento, os serviços de gesso já organizados.',
   'Não marcar nenhuma especialidade e tentar salvar: a prestadora precisa de pelo menos uma para o Hub saber qual biblioteca mostrar.',
   'hub_projetos', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
