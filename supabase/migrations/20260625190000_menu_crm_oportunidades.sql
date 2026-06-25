-- Sidebar: novo item "Oportunidades" no subgrupo projetos_comercial
-- ordem 109 = vem antes de Propostas (110), Clientes (111), Visitas (112).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, icone, descricao)
VALUES ('projetos_oportunidades', 'Oportunidades', 'hub', 'projetos_comercial',
        '/dashboard/projetos/oportunidades', 109, true, 'Target',
        'Funil de vendas: leads, oportunidades, visitas, propostas.')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  rota = EXCLUDED.rota,
  ordem = EXCLUDED.ordem,
  subgrupo = EXCLUDED.subgrupo,
  ativo = EXCLUDED.ativo,
  icone = EXCLUDED.icone,
  descricao = EXCLUDED.descricao;

-- Linka status no feature_catalog (evita "tela orfa" RD-35).
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES ('crm_oportunidades_telas', 'projetos_oportunidades', 'projetos',
        'CRM · Oportunidades (lista + ficha)',
        'Funil de oportunidades: cadastro, etapa, ficha com interacoes, visitas com fotos/GPS e geracao de orcamento.',
        'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  percentual_pronto = EXCLUDED.percentual_pronto,
  descricao_executiva = EXCLUDED.descricao_executiva;
