-- Hub · Gestão de Obras · aba Revisões de escopo — ABERTURA de revisão (Blueprint §16 H2). Code: desenvolvedor_4_g.
--
-- Contexto (RD-26 REUSAR): a camada de dados da abertura JÁ EXISTE e está guardada — a RPC
-- fn_obra_revisao_criar(p_obra_id, p_motivo, p_origem, p_itens) cria a revisão em 'rascunho',
-- valida acesso por company_id (get_user_company_ids) e aplica o PISO do medido por item
-- (quantidade revisada ≥ quantidade já medida). O que faltava era o CAMINHO na tela: o usuário
-- não tinha por onde ABRIR uma revisão — o estado vazio virava beco sem saída (gaps d e g do PDCA).
--
-- Esta fatia liga o botão "Nova revisão" + formulário na própria aba /revisoes à RPC já existente.
-- Esta migration NÃO cria/altera tabela nem função: só SEMEIA as chaves de ajuda ("?") dos campos
-- novos do formulário (RD-95: todo campo/ação tem "?" com chave existente no banco).
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é catálogo
-- global de ajuda (sem company_id, sem dado de cliente). Não altera nenhuma linha existente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.revisao.nova', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Nova revisão',
   'Clique para abrir uma nova revisão de escopo. Informe a origem e o motivo e, se quiser, ajuste quantidade ou preço dos itens que mudaram.',
   'É por aqui que o escopo muda: a revisão nasce como Rascunho e só passa a valer no contrato depois de aprovada.',
   'Abra "Nova revisão" quando o cliente pedir 200 m² a mais de alvenaria e registre o item com a nova quantidade.',
   'Esperar que a revisão já altere o contrato ao ser criada — ela nasce em Rascunho e só muda o valor quando aprovada.', 13),

  ('projetos.revisao.form_origem', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Origem da nova revisão',
   'Escolha de onde partiu a mudança: Interna (decisão da própria empresa) ou Pedido do cliente.',
   'Deixa claro quem pediu a mudança — o que importa para negociar o aditivo e registrar a responsabilidade.',
   'Selecione "Pedido do cliente" quando o contratante solicitar um acréscimo de serviço.',
   'Registrar como interna uma mudança pedida pelo cliente — a origem afeta a negociação do aditivo.', 14),

  ('projetos.revisao.form_motivo', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Motivo da nova revisão',
   'Descreva por que o escopo está mudando, em uma frase clara que qualquer pessoa entenda depois.',
   'Fundamenta o aditivo com o cliente e permite conferir, no futuro, por que o contrato foi revisado.',
   '"Acréscimo de 200 m² de alvenaria por mudança no projeto arquitetônico."',
   'Motivo genérico ("ajuste") que não permite entender a mudança depois.', 15),

  ('projetos.revisao.form_item', '/dashboard/projetos/obras/[id]/revisoes', 'Revisões de escopo', 'hub_projetos',
   'Itens da nova revisão',
   'Para cada item que mudou, informe a nova quantidade e/ou o novo preço unitário. Deixe em branco os itens que não mudaram.',
   'Detalha a mudança item a item — é o que compõe o valor novo da revisão e embasa o aditivo.',
   'No item "Alvenaria", mude a quantidade de 300 para 500 mantendo o preço unitário.',
   'Lançar quantidade abaixo do que já foi medido — o sistema recusa: o medido é o piso do escopo.', 16)
ON CONFLICT (chave) DO NOTHING;
