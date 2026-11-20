-- /dashboard/ehs/matriz (Matriz de Conformidade) · auditor aud8.
-- RD-95: a tela não tinha NENHUMA chave de ajuda (as sub-rotas matriz/* têm as
--   suas, mas a matriz principal estava sem "?"). Cadastra 8 textos de ajuda —
--   grupos/abas, os 4 filtros (tomadora/obra/setor/cargo), "mostrar opcionais",
--   a grade e o Exportar CSV — e o page.tsx passa a renderizar <AjudaCampo>.
-- RD-98 p3: rpcs_chamadas estava NULL. A tela lê por REST (/api/compliance/matriz
--   → views v_compliance_matriz_funcionarios + compliance_tipos_documento) e edita
--   a célula por REST (/api/compliance/dispensas → compliance_dispensas); não chama
--   RPC. views_consumidas já estava correto; marca rpcs_chamadas como [] (classificado:
--   nenhuma RPC — origem já registrada em views_consumidas).
-- Só metadados (erp_ajuda_campo, system_screens); não toca dado de cliente, RLS nem
-- cálculo. Aditiva/idempotente. Faixa de segundos :45 (desenvolvedor_4_g).
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Matriz de Conformidade', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs/matriz', 'compliance', 'publicado'
FROM (VALUES
 ('ehs.matriz.grupos', 'Grupos de documento',
  'Não preenche: são atalhos (abas) para ver só um grupo de documentos — EPI, Pessoal, Saúde, Segurança, Trabalhista, Treinamento — ou "Todos".',
  'Encurta a matriz para o tipo de documento que você quer conferir agora, sem rolar colunas demais.',
  'Clique em "Saúde" para ver só ASO/exames; "Todos" volta a mostrar tudo.',
  'Achar que a matriz "sumiu": você pode estar com um grupo filtrado — volte em "Todos".', 1),
 ('ehs.matriz.filtro_tomadora', 'Tomadora',
  'Escolha uma empresa tomadora (cliente/obra) para ver só os funcionários alocados nela. Em branco = todas.',
  'Foca a conformidade de uma tomadora específica — útil para auditoria daquele cliente/obra.',
  'Selecione "Obra Centro" para conferir só quem presta serviço lá.',
  'Esquecer um filtro ligado e achar que faltam pessoas: confira os filtros ativos no topo.', 2),
 ('ehs.matriz.filtro_obra', 'Obra',
  'Escolha uma obra para ver só os funcionários daquela obra. Em branco = todas.',
  'Separa a conformidade por obra quando a mesma tomadora tem várias frentes.',
  'Selecione "Obra Sul" para ver só os documentos de quem está nessa obra.',
  'Combinar obra de uma tomadora com outra tomadora: a lista fica vazia. Limpe e tente de novo.', 3),
 ('ehs.matriz.filtro_setor', 'Setor',
  'Escolha um setor para ver só os funcionários daquele setor. Em branco = todos.',
  'Agrupa a conformidade por setor — ajuda a ver onde falta documento por área.',
  'Selecione "Produção" para ver só quem é da produção.',
  'Confundir setor com cargo: são filtros diferentes; use os dois juntos para afunilar.', 4),
 ('ehs.matriz.filtro_cargo', 'Cargo',
  'Escolha um cargo para ver só os funcionários daquele cargo. Em branco = todos.',
  'Mostra a conformidade por cargo — útil quando um documento é exigido só de certas funções.',
  'Selecione "Soldador" para conferir os treinamentos exigidos dessa função.',
  'Deixar o cargo filtrado de uma visita anterior e achar que a matriz encolheu: limpe o filtro.', 5),
 ('ehs.matriz.opcionais', 'Mostrar opcionais',
  'Marque para incluir também os documentos OPCIONAIS na matriz; desmarcado, mostra só os obrigatórios.',
  'Deixa a matriz enxuta no dia a dia (só o obrigatório) e permite ver o quadro completo quando precisar.',
  'Desmarcado: a tela avisa quantos opcionais estão ocultos. Marque para revisá-los.',
  'Procurar um documento opcional com a opção desmarcada: ele não aparece até você marcar aqui.', 6),
 ('ehs.matriz.grade', 'A matriz',
  'Não preenche: é a grade funcionários × documentos. Cada célula é um documento de uma pessoa; a cor mostra o status (ok, a vencer, vencido, não emitido, dispensado).',
  'Dá o retrato da conformidade de toda a equipe de uma vez. Clique numa célula para ver detalhes, anexar/substituir o documento ou dispensar a cobrança.',
  'Célula vermelha = documento vencido/não emitido; clique para anexar. Célula cinza "não se aplica" = dispensada.',
  'Tentar editar sem clicar na célula: a edição (anexar/dispensar) abre ao clicar na célula da pessoa.', 7),
 ('ehs.matriz.exportar', 'Exportar Excel (CSV)',
  'Não preenche: baixa a matriz atual (já com os filtros aplicados) em CSV para abrir no Excel.',
  'Leva o quadro de conformidade para fora do sistema — relatório, auditoria, envio à tomadora.',
  'Filtre por uma tomadora e clique em Exportar para gerar o CSV só daquela obra.',
  'Esperar o arquivo com a empresa toda tendo um filtro ligado: o CSV sai conforme os filtros da tela.', 8)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: marca rpcs_chamadas como classificado (nenhuma RPC; origem via REST/views)
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[]::text[], atualizado_em = now()
WHERE rota = '/dashboard/ehs/matriz' AND rpcs_chamadas IS NULL;
