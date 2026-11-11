-- Gestão Empresarial · DRE Divisional (/dashboard/dre-divisional · v_dre_divisional_completo + fn_dre_*)
-- Gap do auditor (pdca_2): RD-95 — 0 "?" (AjudaCampo) em toda a tela (filtros, abas/visão, indicadores, cards por LN,
-- ações e o aviso "N contas sem vínculo"); e RD-98 p3 — system_screens.views_consumidas/rpcs_chamadas NULL para a rota.
-- Este patch:
--  1) RD-95: cadastra 16 chaves de ajuda da tela (filtros Mês/Ano/Visão, badge Rateio, 3 KPIs totais, 4 linhas do card
--     por LN, 4 ações e o aviso de contas sem vínculo). O .tsx passa a renderizar o "?" em cada um.
--  2) RD-98 p3: preenche a origem do dado (views_consumidas/rpcs_chamadas) da rota, derivada do CÓDIGO da tela e das
--     libs que ela importa (api/dre-divisional lê v_dre_divisional_completo + rateio_config_empresa + companies; a tela
--     lê fn_psgc_contas_sem_vinculo, fn_dre_ordem_personalizada_get/set/reset e o modal fn_dre_vincular_categoria_linha).
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo + metadados da própria tela (catálogo de telas); NÃO altera tabela/função,
-- cálculo, RLS nem dado de cliente. Idempotente (ON CONFLICT DO NOTHING; UNION/COALESCE no system_screens).
-- Versão acima da main, faixa de segundos do code-desenvolvedor-3 (:35). Code: code-desenvolvedor-3

-- 1) RD-95 · chaves de ajuda da DRE Divisional
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dre-divisional', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('dre.divisional.filtro.mes', 'Filtros', 'Mês',
  'Escolha o mês de competência que a análise mostra.',
  'Define o período do resultado por linha de negócio. Na visão "Mês atual" olha só esse mês; em YTD acumula de janeiro até ele.',
  'Selecione "Novembro" para ver o resultado de novembro.',
  'Esperar ver o acumulado do ano na visão "Mês atual": para o acumulado use a visão YTD.', 1),
 ('dre.divisional.filtro.ano', 'Filtros', 'Ano',
  'Escolha o ano de competência da análise.',
  'Combina com o mês e a visão para delimitar o período do resultado.',
  '2026.',
  'Trocar o ano e estranhar que a Série 12m mudou: ela sempre termina no mês/ano escolhido e volta 12 meses.', 2),
 ('dre.divisional.filtro.visao', 'Filtros', 'Visão (Mês atual / YTD / Série 12m)',
  'Escolha como o período é somado: só o mês, o acumulado do ano (YTD) ou a série dos últimos 12 meses.',
  'Mês atual compara um mês; YTD mostra o acumulado do exercício; Série 12m revela a tendência mês a mês.',
  'Use YTD para a reunião de resultado do ano; Série 12m para ver se a margem melhora ou piora.',
  'Comparar um mês (Mês atual) com o acumulado de outra empresa (YTD): são bases diferentes.', 3),
 ('dre.divisional.rateio', 'Filtros', 'Método de rateio',
  'Nada a preencher: mostra qual critério distribui as despesas da estrutura SEDE entre as linhas de negócio.',
  'Explica como o EBITDA Real de cada LN absorve o custo da SEDE (por receita, por padrão NBC TG 16).',
  'Rateio: por Receita.',
  'Achar que é editável aqui: o critério se ajusta na configuração de rateio, não neste rótulo.', 4),
 ('dre.divisional.kpi.receita_total', 'Indicadores', 'Receita Total',
  'Nada a preencher: é a soma da receita bruta de todas as linhas de negócio no período.',
  'É a base do rateio e o denominador das margens — tudo se mede em relação a ela.',
  'R$ 1.200.000,00 somando todas as LNs do mês.',
  'Comparar com o faturamento fiscal: aqui é a receita de gestão das LNs, pode diferir do total de notas.', 5),
 ('dre.divisional.kpi.ebitda_pre', 'Indicadores', 'EBITDA Antes Rateio',
  'Nada a preencher: é o EBITDA somado das LNs antes de absorver as despesas da SEDE.',
  'Mostra o resultado operacional das LNs sem o peso da estrutura central — útil para ver a força de cada operação.',
  'R$ 300.000,00 antes de distribuir a SEDE.',
  'Usar este número como lucro final: ele ainda não desconta a estrutura SEDE (veja o EBITDA Real).', 6),
 ('dre.divisional.kpi.ebitda_real', 'Indicadores', 'EBITDA Real',
  'Nada a preencher: é o EBITDA depois de cada LN absorver sua parte das despesas da SEDE (NBC TG 16).',
  'É o resultado operacional de verdade da empresa no período, já com a estrutura central distribuída.',
  'R$ 210.000,00 (17,5% sobre a receita) após o rateio.',
  'Somar com o "Antes Rateio": são o mesmo resultado em dois momentos, não se somam.', 7),
 ('dre.divisional.ln.receita_bruta', 'Linha de negócio', 'Receita Bruta (LN)',
  'Nada a preencher: é a receita bruta daquela linha de negócio no período.',
  'É a fatia da LN na receita total e a base do rateio que ela recebe.',
  'R$ 400.000,00 da linha "Serviços".',
  'Comparar LNs só pela receita: uma LN pode faturar mais e dar menos EBITDA Real.', 8),
 ('dre.divisional.ln.ebitda_pre', 'Linha de negócio', 'EBITDA Antes Rateio (LN)',
  'Nada a preencher: é o EBITDA da LN antes de absorver a SEDE, com a margem sobre a receita bruta.',
  'Mostra a eficiência operacional própria da LN, sem o custo da estrutura central.',
  'R$ 120.000,00 · 30% na linha "Serviços".',
  'Achar que é o resultado final da LN: falta descontar o rateio da SEDE.', 9),
 ('dre.divisional.ln.rateio_sede', 'Linha de negócio', 'Rateio SEDE Absorvido',
  'Nada a preencher: é quanto das despesas da estrutura SEDE esta LN absorveu no período.',
  'É o custo da estrutura central que cabe à LN, proporcional à receita dela.',
  '-R$ 40.000,00 absorvidos pela linha "Serviços".',
  'Esperar que uma LN com receita zero absorva rateio: sem receita, ela não recebe parte da SEDE.', 10),
 ('dre.divisional.ln.ebitda_real', 'Linha de negócio', 'EBITDA Real (LN)',
  'Nada a preencher: é o EBITDA da LN já com o rateio da SEDE absorvido, com o selo Lucro/Prejuízo real.',
  'É o resultado de verdade daquela linha de negócio no período.',
  'R$ 80.000,00 · 20% — "Lucro real" na linha "Serviços".',
  'Decidir fechar uma LN só por este número de um mês: olhe a Série 12m para ver a tendência.', 11),
 ('dre.divisional.acao.plano_contas', 'Ações', 'Plano de contas',
  'Abre o vínculo das contas do plano de contas às linhas de negócio e à DRE.',
  'É onde se corrige "contas sem vínculo": conta vinculada entra no lugar certo do resultado.',
  'Clique para vincular a conta "Energia" à estrutura SEDE.',
  'Ignorar o aviso de contas sem vínculo: elas podem distorcer o rateio até serem classificadas.', 12),
 ('dre.divisional.acao.configurar_ordem', 'Ações', 'Configurar ordem',
  'Abre a tela para reordenar e ocultar linhas de negócio na DRE.',
  'Deixa a DRE na ordem que faz sentido para a sua leitura (as principais primeiro).',
  'Arraste "Serviços" para o topo da lista.',
  'Ocultar uma LN achando que ela sai do cálculo: ela só deixa de ser exibida; o total continua somando.', 13),
 ('dre.divisional.acao.como_calculado', 'Ações', 'Como é calculado',
  'Abre a explicação do método de cálculo (NBC TG 16) usado na DRE Divisional.',
  'Ajuda a entender de onde vêm os números antes de apresentá-los numa reunião.',
  'Clique para ler como o rateio da SEDE é distribuído.',
  'Pular a leitura e questionar o número depois: a explicação já responde a maioria das dúvidas.', 14),
 ('dre.divisional.acao.vincular', 'Ações', 'Vincular categorias',
  'Vincula categorias de lançamento a esta linha de negócio.',
  'Garante que receitas e despesas caiam na LN certa — base para o resultado por linha ficar fiel.',
  'Vincule a categoria "Mão de obra" à linha "Serviços".',
  'Vincular a mesma categoria a duas LNs: o valor seria contado em duplicidade.', 15),
 ('dre.divisional.aviso.sem_vinculo', 'Avisos', 'Contas sem vínculo na DRE',
  'Nada a preencher: avisa quantas contas do plano ainda não têm vínculo com a DRE.',
  'Contas sem vínculo herdam o tipo da conta pai ou da própria conta — resolver deixa o resultado mais preciso.',
  '"3 contas sem vínculo na DRE" com o atalho "Configurar DRE".',
  'Deixar acumular: quanto mais contas sem vínculo, menos confiável fica a separação por linha de negócio.', 16)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 2) RD-98 p3 · origem do dado da rota (aditivo via UNION; nunca remove o que já houver)
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY(SELECT DISTINCT unnest(COALESCE(rpcs_chamadas,'{}'::text[]) || ARRAY[
      'fn_psgc_contas_sem_vinculo','fn_dre_ordem_personalizada_get','fn_dre_ordem_personalizada_set',
      'fn_dre_ordem_personalizada_reset','fn_dre_vincular_categoria_linha',
      'fn_ajuda_campo_listar','fn_ajuda_campo_uso','fn_registrar_evento_auth','fn_registrar_travamento'
    ]::text[]) ORDER BY 1),
    views_consumidas = ARRAY(SELECT DISTINCT unnest(COALESCE(views_consumidas,'{}'::text[]) || ARRAY[
      'v_dre_divisional_completo','rateio_config_empresa','companies','erp_plano_contas','psgc_contas'
    ]::text[]) ORDER BY 1),
    modulo = COALESCE(modulo, 'analises'),
    atualizado_em = now()
WHERE rota = '/dashboard/dre-divisional';
