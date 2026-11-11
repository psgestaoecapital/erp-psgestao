-- Hub · Acompanhamento de obras (portfólio/cronograma) — chamado #3742 (dev7claudeps)
-- A rota /dashboard/projetos/acompanhamento só redirecionava para /obras/resultado (tela financeira),
-- deixando o item de menu "Acompanhamento" sem conteúdo próprio (robô: rota_nao_alcancada). Agora a tela
-- tem a própria visão de ANDAMENTO (cronograma/avanço físico) por obra — lente distinta da lista de obras
-- (status) e do Resultado (financeiro): % físico, tarefas em dia × atrasadas, próxima entrega, última
-- medição e prazo. ADITIVO: cria uma RPC de LEITURA (nada muda em dado de cliente), cadastra as chaves de
-- ajuda RD-95 e marca a tela como auditável pelo robô. RD-38: números provados na DEMO Construtora Modelo
-- (6 obras, 22 tarefas, 66 avanços). Code: dev7claudeps

-- 1) RPC de leitura: portfólio de andamento por obra, escopo fail-closed (igual fn_obras_listar)
CREATE OR REPLACE FUNCTION public.fn_obras_acompanhamento(p_company_ids uuid[])
 RETURNS TABLE(id uuid, numero text, nome text, cliente_nome text, status text, cidade text, uf text,
   responsavel_nome text, data_inicio date, data_prevista_fim date, dias_para_fim integer,
   pct_fisico integer, tarefas_total integer, tarefas_concluidas integer, tarefas_atrasadas integer,
   proxima_entrega date, ultimo_avanco date, medicao_numero integer, medicao_competencia date,
   medicao_status text, situacao text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH tar AS (
    SELECT t.obra_id,
           count(*)::int AS tarefas_total,
           count(*) FILTER (WHERE coalesce(t.percentual,0) >= 100)::int AS tarefas_concluidas,
           count(*) FILTER (WHERE t.fim < current_date AND coalesce(t.percentual,0) < 100)::int AS tarefas_atrasadas,
           round(avg(coalesce(t.percentual,0)))::int AS pct_tarefas,
           min(t.fim) FILTER (WHERE coalesce(t.percentual,0) < 100 AND t.fim >= current_date) AS proxima_entrega
      FROM public.projetos_obra_tarefa t
     WHERE t.company_id = ANY(p_company_ids) AND t.excluido_em IS NULL
     GROUP BY t.obra_id
  ),
  av AS (
    SELECT a.obra_id, max(a.data) AS ultimo_avanco
      FROM public.projetos_obra_tarefa_avanco a
     WHERE a.company_id = ANY(p_company_ids) GROUP BY a.obra_id
  ),
  med AS (
    SELECT DISTINCT ON (m.obra_id) m.obra_id, m.numero AS medicao_numero, m.competencia AS medicao_competencia, m.status AS medicao_status
      FROM public.projetos_obra_medicao m
     WHERE m.company_id = ANY(p_company_ids) AND m.excluido_em IS NULL
     ORDER BY m.obra_id, m.competencia DESC NULLS LAST, m.numero DESC
  )
  SELECT o.id, o.numero, o.nome, o.cliente_nome, o.status, o.cidade, o.uf, o.responsavel_nome,
         o.data_inicio, o.data_prevista_fim, (o.data_prevista_fim - current_date)::int AS dias_para_fim,
         coalesce(o.pct_conclusao, tar.pct_tarefas, 0)::int AS pct_fisico,
         coalesce(tar.tarefas_total,0), coalesce(tar.tarefas_concluidas,0), coalesce(tar.tarefas_atrasadas,0),
         tar.proxima_entrega, av.ultimo_avanco, med.medicao_numero, med.medicao_competencia, med.medicao_status,
         CASE
           WHEN o.status = 'concluida' THEN 'concluida'
           WHEN o.status = 'cancelada' THEN 'cancelada'
           WHEN coalesce(tar.tarefas_total,0) = 0 THEN 'sem_cronograma'
           WHEN coalesce(tar.tarefas_atrasadas,0) > 0 OR (o.data_prevista_fim IS NOT NULL AND o.data_prevista_fim < current_date) THEN 'atrasada'
           ELSE 'em_dia'
         END AS situacao
    FROM public.projetos_obras o
    LEFT JOIN tar ON tar.obra_id = o.id
    LEFT JOIN av ON av.obra_id = o.id
    LEFT JOIN med ON med.obra_id = o.id
   WHERE o.company_id = ANY(p_company_ids) AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL
   ORDER BY CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END,
            o.data_inicio DESC NULLS LAST;
$fn$;

REVOKE ALL ON FUNCTION public.fn_obras_acompanhamento(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_acompanhamento(uuid[]) TO authenticated;

-- 2) Ajuda de campo RD-95 (idempotente por chave)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.acompanhamento.kpi_em_dia','Acompanhamento','Obras em dia',
 'Indicador de leitura (não se preenche). Quantas obras em andamento estão sem tarefa atrasada no cronograma.',
 'Dá em um olhar quantas obras seguem no prazo planejado. Puxa das tarefas do cronograma de cada obra.',
 '3 obras em dia de 6 em andamento.',
 'Achar que "em dia" é a obra concluída: aqui é a obra em andamento cujo cronograma não tem tarefa vencida.',
 1,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.kpi_atrasadas','Acompanhamento','Obras atrasadas',
 'Indicador de leitura. Quantas obras têm ao menos uma tarefa com a data de fim já vencida e ainda não concluída.',
 'Mostra onde o cronograma escorregou — a prioridade de atenção do gestor da carteira de obras.',
 '2 obras atrasadas (toque na obra para ver as tarefas vencidas).',
 'Ignorar a obra atrasada esperando "virar sozinha": o atraso só sai quando a tarefa vencida é concluída ou replanejada.',
 2,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.kpi_pct_medio','Acompanhamento','Avanço físico médio',
 'Indicador de leitura. Média do avanço físico (%) das obras em andamento.',
 'Resumo do quanto a carteira de obras já executou fisicamente, independente do financeiro.',
 '48% = em média as obras em andamento estão quase na metade.',
 'Comparar avanço físico com avanço financeiro: aqui é execução física (tarefas), não faturamento.',
 3,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.busca','Acompanhamento','Buscar obra',
 'Digite parte do número, nome, cliente ou cidade da obra para filtrar a lista.',
 'Encontra rápido a obra que você quer acompanhar sem rolar toda a carteira.',
 'Digitar "clínica" mostra só a obra da Clínica.',
 'Esperar resultado exato: a busca é por trecho — "merc" já acha "Mercado Central".',
 4,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.filtro_situacao','Acompanhamento','Situação do cronograma',
 'Escolha para ver só as obras Em dia, Atrasadas, Sem cronograma ou Concluídas.',
 'Separa a carteira pelo estado do prazo — útil para focar nas atrasadas primeiro.',
 'Selecionar "Atrasadas" lista só as obras com tarefa vencida.',
 'Confundir situação do cronograma com status da obra: uma obra "em andamento" pode estar "atrasada" no cronograma.',
 5,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.pct_fisico','Acompanhamento','Avanço físico',
 'Indicador de leitura. Percentual executado da obra: usa o % informado na obra ou a média das tarefas do cronograma.',
 'Mostra quanto da obra já foi feito de fato, para comparar com o prazo e o faturamento.',
 '56% = pouco mais da metade executada.',
 'Tratar como avanço financeiro: é execução física (tarefas), não o quanto já foi medido/faturado.',
 6,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.cronograma','Acompanhamento','Cronograma',
 'Indicador de leitura. Situação do prazo da obra: Em dia, Atrasada, Sem cronograma ou Concluída.',
 'Resume se a obra está dentro do planejado. Atrasada = há tarefa vencida ou a data de fim prevista já passou.',
 'Etiqueta "Atrasada" em vermelho quando há tarefa vencida.',
 'Ler "Sem cronograma" como erro: significa que a obra ainda não teve tarefas cadastradas no cronograma.',
 7,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.tarefas','Acompanhamento','Tarefas',
 'Indicador de leitura. Quantas tarefas do cronograma estão concluídas e quantas estão atrasadas, do total.',
 'Mostra o detalhe por trás do avanço: o que já fechou e o que está vencido na obra.',
 '2 de 6 concluídas · 2 atrasadas.',
 'Olhar só o total: o número de atrasadas é o que pede ação imediata.',
 8,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.proxima_entrega','Acompanhamento','Próxima entrega',
 'Indicador de leitura. Data de fim da próxima tarefa ainda não concluída da obra.',
 'Diz o que vence a seguir no cronograma, para o gestor se antecipar.',
 '15/11 = a próxima tarefa aberta vence nesse dia.',
 'Confundir com a data de fim da obra: é a próxima tarefa, não o término total.',
 9,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.medicao','Acompanhamento','Última medição',
 'Indicador de leitura. Número e situação da medição mais recente da obra (traço quando ainda não houve medição).',
 'Liga o avanço físico ao ciclo de medição/faturamento — mostra se a execução já virou medição.',
 'Medição 1 · aprovada.',
 'Esperar medição em obra sem cronograma avançado: a medição costuma vir depois da execução das tarefas.',
 10,'/dashboard/projetos/acompanhamento','hub','publicado'),
('projetos.acompanhamento.prazo','Acompanhamento','Prazo',
 'Indicador de leitura. Dias que faltam para a data de fim prevista (negativo quando a data já passou).',
 'Mostra o fôlego de prazo da obra — valores negativos sinalizam atraso no término previsto.',
 '10 dias para o fim previsto; "-29" = passou 29 dias do previsto.',
 'Ignorar o prazo negativo: a data de fim prevista já venceu e precisa de replanejamento.',
 11,'/dashboard/projetos/acompanhamento','hub','publicado')
ON CONFLICT (chave) DO UPDATE SET
  grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  ordem=EXCLUDED.ordem, rota=EXCLUDED.rota, vertical=EXCLUDED.vertical, status=EXCLUDED.status,
  atualizado_em=now();

-- 3) A tela agora tem conteúdo próprio e pode ser auditada pelo robô
UPDATE public.system_screens SET
  modulo = COALESCE(modulo, 'projetos_obras'),
  estado_real = 'parcial',
  auditavel_robo = true,
  motivo_nao_auditavel = NULL,
  descricao_funcional = 'Acompanhamento de obras (portfólio): avanço físico, cronograma (em dia/atrasada), próxima entrega, última medição e prazo por obra. Fonte: fn_obras_acompanhamento.',
  rpcs_chamadas = ARRAY(SELECT DISTINCT unnest(COALESCE(rpcs_chamadas,'{}'::text[]) || ARRAY['fn_obras_acompanhamento','fn_ajuda_campo_listar']::text[]) ORDER BY 1),
  views_consumidas = ARRAY(SELECT DISTINCT unnest(COALESCE(views_consumidas,'{}'::text[]) || ARRAY['projetos_obras','projetos_obra_tarefa','projetos_obra_tarefa_avanco','projetos_obra_medicao']::text[]) ORDER BY 1),
  atualizado_em = now()
WHERE rota = '/dashboard/projetos/acompanhamento';
