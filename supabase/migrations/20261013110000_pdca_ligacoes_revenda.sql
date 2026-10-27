-- PDCA · MAPA DE LIGAÇÕES — fatia 3: Revenda de Veículos (msg 0c4baabe). Aditivo: só INSERT no catálogo (ON CONFLICT DO NOTHING).
-- DEMO da vertical: Revenda …03 (demo_por_area 'revenda_veiculos'). Cada SQL recebe $1 = company_id e devolve (esperado, encontrado).
-- Dono do código da vertical: rodrigo-code (tarefa automática de ligação vermelha vai para ele).
INSERT INTO public.pdca_ligacao (vertical, codigo, origem_rota, acao, destino_rota, deve_aparecer, sql_conferencia, code_dono) VALUES
('revenda_veiculos','REV-01','/dashboard/revenda/patio','Dar entrada de veículo no pátio','/dashboard/revenda/precificacao',
 'Todo veículo ativo do pátio tem situação e aparece para precificar',
 $q$SELECT count(*)::int, (SELECT count(*) FROM veic_veiculo WHERE company_id=$1 AND ativo AND deleted_at IS NULL AND situacao IS NOT NULL)::int FROM veic_veiculo WHERE company_id=$1 AND ativo AND deleted_at IS NULL$q$,'rodrigo-code'),
('revenda_veiculos','REV-02','/dashboard/revenda/veiculo','Lançar custo de preparação no veículo','/dashboard/revenda/preparacao',
 'Existem custos lançados em veículos da DEMO, ligados a veículo existente',
 $q$SELECT 1, (SELECT count(*) FROM veic_custo c JOIN veic_veiculo v ON v.id=c.veiculo_id WHERE c.company_id=$1 AND c.deleted_at IS NULL)::int$q$,'rodrigo-code'),
('revenda_veiculos','REV-03','/dashboard/revenda/negociacao','Fechar a venda do veículo','/dashboard/revenda/vendas',
 'Toda venda da DEMO aponta para um veículo existente',
 $q$SELECT (SELECT count(*) FROM veic_venda WHERE company_id=$1 AND deleted_at IS NULL)::int, (SELECT count(*) FROM veic_venda s JOIN veic_veiculo v ON v.id=s.veiculo_id WHERE s.company_id=$1 AND s.deleted_at IS NULL)::int$q$,'rodrigo-code'),
('revenda_veiculos','REV-04','/dashboard/revenda/vendas','Registrar forma de recebimento da venda','/dashboard/financeiro',
 'Toda venda da DEMO tem recebimento previsto (veic_venda_recebimento)',
 $q$SELECT (SELECT count(*) FROM veic_venda WHERE company_id=$1 AND deleted_at IS NULL)::int, (SELECT count(DISTINCT r.venda_id) FROM veic_venda_recebimento r JOIN veic_venda s ON s.id=r.venda_id WHERE r.company_id=$1 AND s.deleted_at IS NULL)::int$q$,'rodrigo-code')
ON CONFLICT (vertical, codigo) DO NOTHING;
