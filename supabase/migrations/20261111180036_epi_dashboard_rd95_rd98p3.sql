-- Compliance · EPI — Dashboard (/dashboard/compliance/epi) · Auditoria visual aud8 09/11
-- Gaps: critério d (estados vazios dos gráficos sem ação), RD-95 (0 "?"), RD-98 p3 (origem do dado nula).
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente): só chaves de ajuda + origem do dado.
--   1) RD-95 "?" dos KPIs, pontos de atenção, atalhos e gráficos.
--   2) system_screens: origem do dado (RD-98 p3).
-- (Os CTAs dos estados vazios são de front — levam ao Catálogo/Estoque; não precisam de banco.)
-- Faixa de migration do code-desenvolvedor-3 (segundos :36), acima da main.

-- 1) RD-95 "?" (idempotente) ───────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/compliance/epi', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.epi.nav.catalogo','Atalhos','Catálogo','Clique para abrir o catálogo de EPIs (os tipos de equipamento que a empresa fornece).','Cadastra e consulta os modelos de EPI (capacete, luva, bota…) com CA e validade.','Abra o Catálogo para incluir "Luva nitrílica CA 12345".','Confundir catálogo (modelos) com estoque (quantidade em mãos).',1),
 ('compliance.epi.nav.estoque','Atalhos','Estoque','Clique para abrir o estoque de EPIs (entradas, saídas e saldo por item).','Controla a quantidade disponível e registra as movimentações.','Registre a entrada de 50 pares de luva.','Esquecer de dar entrada: o saldo fica negativo/zerado.',2),
 ('compliance.epi.nav.fichas','Atalhos','Fichas','Clique para abrir as fichas de EPI por funcionário (entrega e devolução assinadas).','Comprova a entrega de EPI a cada colaborador (NR-6/eSocial).','Abra a ficha de um eletricista para registrar a entrega do capacete.','Entregar sem registrar na ficha: perde a comprovação legal.',3),
 ('compliance.epi.nav.alertas','Atalhos','Alertas','Clique para ver os alertas de EPI (vencimentos, trocas e estoque baixo). O número é o total de alertas ativos.','Mostra o que precisa de ação para manter o compliance de EPI.','"3" indica 3 alertas abertos — clique para ver quais.','Ignorar o contador: ele some só quando o alerta é resolvido.',4),
 ('compliance.epi.kpi.total_funcionarios','Visão geral','Total funcionários','Nada a preencher: total de funcionários das empresas selecionadas.','Dá a base para o quanto de EPI é necessário.','150 funcionários.','—',5),
 ('compliance.epi.kpi.epis_catalogo','Visão geral','EPIs no catálogo','Nada a preencher: quantos tipos de EPI estão cadastrados no catálogo.','Mostra a variedade de EPIs que a empresa controla.','24 tipos de EPI.','0 significa catálogo vazio — cadastre no Catálogo.',6),
 ('compliance.epi.kpi.fichas_uso','Visão geral','Fichas em uso','Nada a preencher: fichas de EPI ativas (com entrega registrada).','Mostra quantos colaboradores têm EPI entregue e em uso.','120 fichas em uso.','—',7),
 ('compliance.epi.kpi.movimentacoes_30d','Visão geral','Movimentações 30d','Nada a preencher: entradas e saídas de estoque de EPI nos últimos 30 dias.','Mostra o giro recente do estoque de EPI.','45 movimentações no mês.','0 pode ser falta de registro, não só ausência de giro.',8),
 ('compliance.epi.atencao.alertas_ativos','Pontos de atenção','Alertas ativos','Nada a preencher: total de alertas de EPI em aberto.','Resume o que precisa de ação no EPI.','3 alertas ativos.','—',9),
 ('compliance.epi.atencao.alertas_criticos','Pontos de atenção','Alertas críticos','Nada a preencher: alertas de EPI de prioridade crítica (ação imediata).','Destaca o risco mais urgente de EPI.','1 alerta crítico.','Deixar crítico sem ação: é risco de NR e multa.',10),
 ('compliance.epi.atencao.estoque_critico','Pontos de atenção','Estoque crítico','Nada a preencher: itens de EPI com saldo abaixo do mínimo.','Avisa o que precisa de reposição para não faltar EPI.','2 itens em estoque crítico.','Esperar zerar para repor: o EPI pode faltar na entrega.',11),
 ('compliance.epi.atencao.trocas_atrasadas','Pontos de atenção','Trocas atrasadas','Nada a preencher: EPIs cuja troca por validade/uso já venceu.','Mostra o EPI que deveria ter sido substituído.','4 trocas atrasadas.','EPI vencido em uso não protege e reprova em auditoria.',12),
 ('compliance.epi.grafico.categoria','Gráficos','Distribuição EPIs por categoria','Nada a preencher: distribui os EPIs do catálogo por categoria.','Mostra onde está concentrado o catálogo de EPI.','Mais itens em "Proteção das mãos".','Vazio = catálogo sem EPI cadastrado.',13),
 ('compliance.epi.grafico.movimentacoes','Gráficos','Movimentações últimos 6 meses','Nada a preencher: entradas e saídas de EPI, mês a mês, nos últimos 6 meses.','Mostra a tendência de consumo/reposição de EPI.','Pico de saídas no mês de admissões.','Vazio = sem movimentação de estoque registrada.',14)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 2) RD-98 p3 · origem do dado ─────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_epi_dashboard']::text[],
       rpcs_chamadas   = ARRAY['fn_ajuda_campo_listar']::text[]
 WHERE rota = '/dashboard/compliance/epi';
