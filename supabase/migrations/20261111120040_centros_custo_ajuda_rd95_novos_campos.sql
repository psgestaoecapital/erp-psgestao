-- PDCA GE /dashboard/gestao-empresarial/centros-custo (Princ.1 núcleo universal + RD-95/RD-99):
-- "?" (RD-95) nos campos do cadastro manual, na busca e no filtro por situação (novos nesta tela).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não toca dado de cliente. Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ge.centros_custo.novo_nome','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Nome do centro',
   'Digite um nome curto e estável para o centro de custo (em MAIÚSCULAS, sem espaço) que você vai usar nos lançamentos.',
   'Cria o mapeamento ANTES de existir lançamento, resolvendo o ovo-e-galinha: o centro já fica pronto para ser escolhido na despesa/receita.',
   'ADMIN, COMERCIAL, PROJETO_X.','Usar nomes diferentes para a mesma coisa (ex.: "Administrativo" e "ADMIN") — padronize um só.','gestao_empresarial',20,1,'publicado'),
  ('ge.centros_custo.novo_tipo','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Tipo de apropriação',
   'Escolha como o custo se apropria: direto (atribuível a UMA linha/dimensão), comum (rateado entre linhas) ou extra (fora do rateio, a revisar).',
   'Define o comportamento do centro no rateio → resultado por negócio → DRE.',
   'Aluguel do escritório = comum; obra específica = direto.','Marcar tudo como "extra": extra fica de fora do rateio e some do resultado por linha.','gestao_empresarial',21,1,'publicado'),
  ('ge.centros_custo.novo_linha','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Linha de negócio',
   'Escolha a linha de negócio a que este centro pertence (opcional para comum/extra; recomendada para direto).',
   'Liga o custo à linha certa para o resultado por negócio e a DRE divisional ficarem corretos.',
   'Linha "Varejo" para o centro COMERCIAL.','Deixar em branco em centro direto: o custo não chega à linha e o resultado fica incompleto.','gestao_empresarial',22,1,'publicado'),
  ('ge.centros_custo.novo_lote','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Lote (se direto)',
   'Só aparece quando a empresa tem lotes cadastrados. Escolha o lote quando o tipo for "direto" e o custo pertencer a um lote específico.',
   'Direciona o custo direto ao lote exato (dimensão opcional, usada por empresas que trabalham com lotes).',
   'Lote 2026-A para um custo direto desse lote.','Escolher lote em custo que não é "direto": o campo só vale para apropriação direta.','gestao_empresarial',23,1,'publicado'),
  ('ge.centros_custo.novo_cadastrar','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Cadastrar',
   'Nada a preencher — clique para salvar o novo centro de custo com o tipo e a linha escolhidos.',
   'Grava o mapeamento para que o centro já apareça na hora de lançar despesa/receita.',
   'Preencher Nome + Tipo e clicar em "+ Cadastrar".','Clicar sem preencher o Nome: o centro não é criado.','gestao_empresarial',24,1,'publicado'),
  ('ge.centros_custo.busca','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Buscar',
   'Digite parte do nome do centro de custo para filtrar a lista.',
   'Acha rápido um centro específico quando a lista é grande, sem rolar tudo.',
   'Buscar "COM" para ver COMERCIAL e COMPRAS.','—','gestao_empresarial',25,1,'publicado'),
  ('ge.centros_custo.filtro_status','/dashboard/gestao-empresarial/centros-custo','Centros de custo','Filtro por situação',
   'Escolha entre Todos, Não mapeados, Mapeados ou Inativos.',
   'Foca na situação que você quer tratar agora — por padrão os NÃO mapeados aparecem no topo, pois são os que travam o rateio.',
   'Não mapeados → só os centros que ainda faltam configurar.','—','gestao_empresarial',26,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
