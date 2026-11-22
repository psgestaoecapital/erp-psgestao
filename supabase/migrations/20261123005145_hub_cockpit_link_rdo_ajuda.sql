-- Hub · tela 321 (Diário de Obra / RDO): a tela /dashboard/projetos/obras/[id]/rdo JÁ EXISTE
-- (Livro de Ordem, CONFEA 1.094/2017), mas NÃO havia atalho no cockpit da obra — o usuário só
-- chegava por URL (RD-98: tela viva, mas invisível na jornada). Esta migration apenas semeia o "?"
-- (RD-95) do novo link "Diário de obra (RDO) →" adicionado ao bloco "Ações da obra" do cockpit.
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); catálogo de ajuda, não toca dado de cliente.
-- RD-100: sem nome de outro sistema. Linguagem do usuário (engenheiro/mestre de obra).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.cockpit.rdo', '/dashboard/projetos/obras/[id]/cockpit', 'Ações da obra',
   'Diário de obra (RDO)',
   'Abre o Diário de Obra (RDO) desta obra, onde se registra o que aconteceu no dia: clima, equipes, ocorrências e avanço.',
   'Reúne o registro diário da execução (Livro de Ordem), base para acompanhamento, medição e defesa em caso de atraso ou pendência.',
   'Clique para abrir o diário e lançar o registro de hoje.',
   'Procurar o diário num menu separado: ele abre a partir do cockpit da obra.',
   'hub_projetos', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
