-- Módulo admin "Solicitações de Peça" no menu da oficina (destino do alerta do R5). Aditivo.
INSERT INTO module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, legacy)
SELECT 'oficina_solicitacoes_peca', 'Solicitações de Peça', 'oficina', 'oficina_atendimento', 'Package',
       '/dashboard/oficina/solicitacoes', 13, true, false
WHERE NOT EXISTS (SELECT 1 FROM module_catalog WHERE id='oficina_solicitacoes_peca');

INSERT INTO plan_modules (plan_id, module_id)
SELECT p, 'oficina_solicitacoes_peca'
FROM (VALUES ('v15_oficina_grande'),('v15_oficina_media'),('v15_oficina_pequena')) x(p)
WHERE NOT EXISTS (SELECT 1 FROM plan_modules WHERE plan_id=x.p AND module_id='oficina_solicitacoes_peca');

INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT gen_random_uuid(), 'oficina_solicitacoes_peca', 'oficina', 'Solicitações de Peça',
       'Dono decide as peças que o mecânico solicitou (foto, qtd, preço).', 'pronto', 100
WHERE NOT EXISTS (SELECT 1 FROM feature_catalog WHERE module_id='oficina_solicitacoes_peca');
