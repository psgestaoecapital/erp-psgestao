-- Indústria/RH · Vagas e reposição de quadro — ajuda RD-95 + registro RD-98 da tela nova /dashboard/industrial/vagas.
-- A camada rh_vaga (tabela, RLS por company_id, REVOKE anon e RPCs fn_rh_vaga_abrir/decidir/cancelar/listar/pode_decidir
-- com guarda de papel SECURITY DEFINER) JÁ está publicada na #3691; esta migration só acrescenta o texto de ajuda dos
-- campos da tela e registra a rota em system_screens. A leitura/escrita é toda front→RPC (RD-26): nenhuma função, tabela,
-- RLS ou grant é criada/alterada aqui, nenhum dado de cliente é tocado.
--
-- RD-38 (produção, só leitura, nesta sessão): as 5 RPCs fn_rh_vaga_* existem em pg_proc; fn_rh_vaga_listar devolve
-- {itens, pode_decidir}; fn_rh_vaga_abrir grava status 'aprovada' quando origem='reposicao' e 'solicitada' quando
-- 'criacao', validando setor_id/cargo_id contra prod_setor/prod_cargo da própria empresa.
--
-- ADITIVA e idempotente: ajuda por ON CONFLICT (chave) DO NOTHING (erp_ajuda_campo tem UNIQUE(chave) global);
-- system_screens por ON CONFLICT (rota) DO NOTHING.
-- RD-52: arquivo + PR, versão 20261108214545 acima da última da main, faixa de segundos :45–:54.
-- Observação (menu): a entrada em module_catalog/plano (subgrupo rh_ponto do grupo industrial, ao lado de Folha/Mão de
-- Obra/Ponto) depende de decisão de catálogo/plano do Eng. Chefe e NÃO é feita aqui (regra "não tocar catálogo/menu sem
-- ordem"); a rota já funciona por URL e fica registrada em system_screens.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('industrial.vaga.resumo', '/dashboard/industrial/vagas', 'Indicadores', 'Vagas em análise',
   'Indicador automático: não se preenche. Soma a quantidade de pessoas das vagas em cada situação.',
   'Mostra, de relance, quantas posições estão aguardando decisão, já aprovadas e recusadas no período atual — para a diretoria enxergar a pressão sobre o quadro.',
   '2 vagas em análise com quantidade 3 e 1 somam 4 pessoas em análise.',
   'Confundir número de vagas com número de pessoas: uma vaga pode pedir várias pessoas (quantidade).',
   'industrial', 10, 'publicado'),
  ('industrial.vaga.origem', '/dashboard/industrial/vagas', 'Abrir vaga', 'Origem',
   'Escolha "Reposição do quadro" quando a vaga substitui alguém que saiu (não aumenta o quadro) ou "Criação (acima do quadro)" quando é uma posição nova.',
   'Define o fluxo de aprovação: reposição já entra aprovada (o quadro foi aprovado antes); criação acima do quadro aguarda a diretoria decidir, pois aumenta o custo de pessoal.',
   'Saiu um operador da linha e você quer repor → Reposição. Vai abrir um turno novo → Criação.',
   'Marcar criação para uma simples reposição faz a vaga esperar aprovação sem necessidade.',
   'industrial', 20, 'publicado'),
  ('industrial.vaga.setor', '/dashboard/industrial/vagas', 'Abrir vaga', 'Setor',
   'Selecione o setor da planta onde a vaga será alocada. A lista traz os setores cadastrados da empresa.',
   'Organiza as vagas por área e permite enxergar onde está a maior necessidade de pessoas.',
   'Desossa, Embalagem, Expedição.',
   'Escolher o setor errado faz a vaga não aparecer para o responsável certo.',
   'industrial', 30, 'publicado'),
  ('industrial.vaga.cargo', '/dashboard/industrial/vagas', 'Abrir vaga', 'Cargo',
   'Selecione o cargo da vaga. A lista traz os cargos cadastrados da empresa.',
   'Identifica a função a ser contratada e serve de base para o custo estimado e para o recrutamento.',
   'Operador de produção, Auxiliar de limpeza, Encarregado.',
   'Deixar o cargo em branco: setor e cargo são obrigatórios para abrir a vaga.',
   'industrial', 40, 'publicado'),
  ('industrial.vaga.posto', '/dashboard/industrial/vagas', 'Abrir vaga', 'Posto',
   'Opcional. Selecione o posto de trabalho específico quando a vaga é para uma posição exata na linha. A lista mostra os postos do setor escolhido.',
   'Liga a vaga ao posto do mapa de produção, ajudando a enxergar a lacuna exatamente onde ela está.',
   'Posto 12 · Serra de corte.',
   'Escolher o setor depois do posto: troque o setor primeiro, pois a lista de postos é filtrada por setor.',
   'industrial', 50, 'publicado'),
  ('industrial.vaga.quantidade', '/dashboard/industrial/vagas', 'Abrir vaga', 'Quantidade',
   'Informe quantas pessoas essa vaga precisa. O mínimo é 1.',
   'Permite abrir numa única solicitação várias posições iguais (mesmo setor e cargo) e dá a soma de pessoas nos indicadores.',
   '3 operadores para o mesmo cargo e setor → quantidade 3.',
   'Abrir três vagas separadas quando uma com quantidade 3 bastaria.',
   'industrial', 60, 'publicado'),
  ('industrial.vaga.custo_estimado', '/dashboard/industrial/vagas', 'Abrir vaga', 'Custo mensal estimado',
   'Opcional. Informe o custo mensal estimado da vaga (salário + encargos), em reais.',
   'Ajuda a diretoria a decidir a criação acima do quadro, mostrando o impacto no custo de pessoal.',
   '4500 para um custo de R$ 4.500,00 por mês.',
   'Informar o salário bruto sem os encargos subestima o custo real da contratação.',
   'industrial', 70, 'publicado'),
  ('industrial.vaga.justificativa', '/dashboard/industrial/vagas', 'Abrir vaga', 'Justificativa',
   'Explique por que a vaga é necessária. Quanto mais clara, mais rápida a decisão.',
   'Dá contexto para quem aprova e fica registrada no histórico da vaga.',
   'Substituir desligamento do João; aumento de 20% no volume da linha de cortes.',
   'Deixar vago ("precisa de gente") dificulta a aprovação e a priorização.',
   'industrial', 80, 'publicado'),
  ('industrial.vaga.busca', '/dashboard/industrial/vagas', 'Filtros', 'Buscar',
   'Digite parte do setor, cargo, origem ou justificativa para filtrar a lista. A busca ignora acentos e maiúsculas.',
   'Encontra rapidamente uma vaga numa lista grande sem precisar rolar tudo.',
   '"desossa" mostra só as vagas desse setor.',
   'Esperar que a busca filtre por data: ela cobre os textos da vaga, não o período.',
   'industrial', 90, 'publicado'),
  ('industrial.vaga.filtro_status', '/dashboard/industrial/vagas', 'Filtros', 'Situação',
   'Selecione a situação para ver só as vagas em análise, aprovadas, recusadas ou canceladas.',
   'Foca a lista no que importa agora — por exemplo, só o que está esperando decisão.',
   '"Em análise" mostra apenas as vagas que aguardam a diretoria.',
   'Esquecer o filtro ativo e achar que "sumiram" vagas que estão só escondidas por ele.',
   'industrial', 100, 'publicado'),
  ('industrial.vaga.decisao', '/dashboard/industrial/vagas', 'Ações', 'Decisão da vaga',
   'Ações disponíveis para uma vaga em análise. Aprovar e Recusar aparecem só para quem tem permissão de decidir (diretoria); Cancelar fica disponível para quem abriu a vaga ou para a diretoria.',
   'Conduz a vaga até a decisão final. O próprio sistema impede que o solicitante aprove a própria vaga.',
   'A diretoria aprova a reposição; quem abriu cancela uma vaga aberta por engano.',
   'Tentar decidir uma vaga já aprovada ou recusada: só vagas em análise podem ser decididas.',
   'industrial', 110, 'publicado'),
  ('industrial.vaga.motivo', '/dashboard/industrial/vagas', 'Ações', 'Motivo',
   'Escreva o motivo da decisão. É obrigatório ao recusar e opcional ao aprovar ou cancelar.',
   'Registra por que a vaga foi aprovada, recusada ou cancelada, deixando o histórico claro.',
   'Recusada: "orçamento de pessoal congelado neste trimestre".',
   'Recusar sem motivo: o campo é exigido para a recusa, para a pessoa entender a decisão.',
   'industrial', 120, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, estado_real, prioridade_monitoramento, modulo, auditavel_robo)
VALUES (
  'dashboard.industrial_vagas',
  '/dashboard/industrial/vagas', 'industrial', 'Vagas e reposição de quadro',
  'Abertura, análise e decisão de vagas sobre a camada rh_vaga: reposição do quadro entra aprovada; criação acima do quadro aguarda a diretoria; aprovar/recusar (só quem decide, nunca o solicitante) e cancelar (solicitante ou diretoria) com motivo. Escrita só por RPC com guarda de papel; permissão de decidir vem do banco.',
  ARRAY['rh_vaga','prod_setor','prod_cargo','prod_posto']::text[],
  ARRAY['fn_rh_vaga_listar','fn_rh_vaga_abrir','fn_rh_vaga_decidir','fn_rh_vaga_cancelar','fn_ajuda_campo_listar']::text[],
  'parcial', 'media', 'industrial_mao_obra', true
)
ON CONFLICT (rota) DO NOTHING;
