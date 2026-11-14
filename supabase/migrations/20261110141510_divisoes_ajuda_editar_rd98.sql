-- RD-95 ("?" em toda ação) + RD-98 p2 (ação Editar) · Divisões (Cadastros · Gestão Empresarial).
-- Gap do auditor aud8 (/dashboard/cadastros/divisoes, score 70): "RD-98 p2: sem ação Editar —
-- não dá para alterar nome nem cor de uma divisão já criada". O componente LinhasNegocioList passou
-- a ter o botão "Editar" (nome + cor) e a confirmação antes de Inativar; esta migration cadastra a
-- chave de ajuda do novo botão "Editar", referenciada por <AjudaCampo chave="ge.divisoes.editar" />.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente).
-- ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.divisoes.editar','Divisões da empresa','Editar divisão',
 'Abre a divisão para você corrigir o nome e a cor sem precisar recriá-la; o planejado, o histórico e o DRE continuam vinculados.',
 'Serve para ajustar um nome digitado errado ou trocar a cor de identificação nos gráficos, mantendo a mesma divisão.',
 'Renomear "Divisão 1" para "Tintas" ou trocar a cor para diferenciá-la de outra área parecida.',
 'Criar uma divisão nova só para mudar o nome — isso duplica a área; use Editar para manter o planejado e o histórico.',
 7,'/dashboard/cadastros/divisoes','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
