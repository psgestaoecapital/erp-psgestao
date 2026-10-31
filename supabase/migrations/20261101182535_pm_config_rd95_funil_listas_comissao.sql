-- RD-95 (CEO 08/10): fechar o "?" da tela Configurações do Sistema (P&M) · /dashboard/pm/configuracoes.
-- O auditor PDCA (aud8 85/95, 31/10) pediu "AjudaCampo em cada campo editável de TODAS as abas". As abas
-- Alertas e Proposta já tinham "?" (migration 20261101130445). Faltavam as abas Funil (renomear etapa,
-- cor, situação), Listas (tipo de lista, opção, nova opção) e Comissões (o que cada linha mostra).
-- Este texto explica cada controle sem mexer no cálculo/fluxo — resolve a dúvida sem sair da tela.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/configuracoes', 'pm', 'publicado'
FROM (VALUES
 ('pm.config.funil_rotulo', 'Configurações · Funil', 'Nome da etapa',
  'O nome que a etapa do funil de leads mostra no kanban. Pode renomear à vontade.',
  'Deixa o funil com a linguagem da sua equipe sem mexer na lógica — a chave interna da etapa não muda, então nenhum lead se perde ao renomear.',
  'Trocar "Qualificação" por "Primeiro contato".',
  'Achar que renomear move os leads: só muda o rótulo; os leads continuam na mesma etapa.',
  1),
 ('pm.config.funil_cor', 'Configurações · Funil', 'Cor da etapa',
  'A cor da coluna da etapa no kanban de leads. Escolha no seletor de cor.',
  'Ajuda a bater o olho e identificar a etapa pela cor, útil quando há muitas colunas.',
  'Verde para "Ganho", vermelho para "Perdido".',
  'Usar duas etapas com a mesma cor: fica difícil distinguir as colunas de relance.',
  2),
 ('pm.config.funil_situacao', 'Configurações · Funil', 'Situação / salvar',
  'Deixe a etapa "ativa" para aparecer no kanban ou "oculta" para escondê-la, e clique em Salvar para aplicar.',
  'Permite esconder uma etapa que não usa mais sem apagá-la — os leads que já passaram por ela ficam preservados.',
  'Ocultar "Reativação" enquanto a campanha não começa; reativar depois.',
  'Esquecer de clicar em Salvar: a mudança de nome, cor ou situação só vale depois de salvar a etapa.',
  3),
 ('pm.config.listas_tipo', 'Configurações · Listas', 'Tipo de lista',
  'Escolha qual lista reutilizável editar: Áreas/equipe, Periodicidade, Unidades ou Redes sociais.',
  'Cada lista alimenta os seletores de outras telas (ex.: a área da equipe, a rede social do post) — manter aqui evita digitar o mesmo valor em vários lugares.',
  'Em "Redes sociais", manter Instagram, LinkedIn e TikTok.',
  'Procurar uma opção na lista errada: confira primeiro qual tipo de lista está selecionado.',
  4),
 ('pm.config.listas_rotulo', 'Configurações · Listas', 'Opção da lista',
  'O texto da opção, como ela aparece nos seletores. Edite e a mudança salva ao sair do campo; use "ativa/oculta" para mostrar ou esconder e "✕" para remover.',
  'Mantém as opções com a linguagem da sua operação. Opção em uso não pode ser removida (o sistema avisa) — oculte no lugar, para não quebrar registros antigos.',
  'Renomear "Social" para "Mídias sociais".',
  'Tentar remover uma opção que já está em uso: o sistema recusa; oculte-a em vez de apagar.',
  5),
 ('pm.config.listas_nova', 'Configurações · Listas', 'Nova opção',
  'Digite o texto da nova opção e clique em Adicionar (ou tecle Enter). O código interno é gerado a partir do texto.',
  'Acrescenta uma opção à lista selecionada para usá-la imediatamente nos seletores das outras telas.',
  'Em "Unidades", adicionar "Diária".',
  'Deixar o campo em branco e clicar em Adicionar: nada é criado — a opção precisa de um texto.',
  6),
 ('pm.config.comissao_item', 'Configurações · Comissões', 'Comissão gerada',
  'Lista só de leitura: cada linha é uma comissão já lançada numa proposta aprovada (valor, percentual sobre a base, competência e situação).',
  'Mostra o que já foi gerado de comissão para conferência. O cadastro de regra de comissão ainda não existe (decisão do CEO) — por isso esta aba só exibe o que foi lançado.',
  'R$ 1.200,00 · 10% de R$ 12.000,00 · 2026-10 · provisionada.',
  'Esperar editar a régua de comissão aqui: por enquanto a aba é apenas consulta do que foi gerado.',
  7)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
