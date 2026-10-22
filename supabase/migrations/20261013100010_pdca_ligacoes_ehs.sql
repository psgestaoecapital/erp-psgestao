-- PDCA · MAPA DE LIGAÇÕES — fatia 2: PS EHS (msg 0c4baabe). Aditivo: só INSERT no catálogo (ON CONFLICT DO NOTHING).
-- DEMO da vertical: Indústria (SST) …05 (demo_por_area 'ehs'). Cada SQL recebe $1 = company_id e devolve (esperado, encontrado).
INSERT INTO public.pdca_ligacao (vertical, codigo, origem_rota, acao, destino_rota, deve_aparecer, sql_conferencia, code_dono) VALUES
('ehs','EHS-01','/dashboard/compliance/funcionarios','Cadastrar funcionário em um setor','/dashboard/compliance/setores',
 'Todo funcionário ativo da DEMO está ligado a um setor (setor_id)',
 $q$SELECT count(*)::int, (SELECT count(*) FROM compliance_funcionarios WHERE company_id=$1 AND ativo AND setor_id IS NOT NULL)::int FROM compliance_funcionarios WHERE company_id=$1 AND ativo$q$,'gilberto-chamados'),
('ehs','EHS-02','/dashboard/compliance/epi/catalogo','Entregar EPI ao funcionário','/dashboard/compliance/epi/fichas',
 'Há ficha de EPI para funcionários da DEMO (epi_ficha ligada ao catálogo)',
 $q$SELECT 1, (SELECT count(*) FROM epi_ficha f JOIN epi_catalogo c ON c.id=f.catalogo_id WHERE f.company_id=$1)::int$q$,'gilberto-chamados'),
('ehs','EHS-03','/dashboard/compliance/epi/fichas','Entregar EPI (baixa de estoque)','/dashboard/compliance/epi/estoque',
 'Todo item do catálogo com ficha tem linha de estoque',
 $q$SELECT (SELECT count(DISTINCT catalogo_id) FROM epi_ficha WHERE company_id=$1)::int, (SELECT count(DISTINCT e.catalogo_id) FROM epi_estoque e WHERE e.company_id=$1 AND e.catalogo_id IN (SELECT catalogo_id FROM epi_ficha WHERE company_id=$1))::int$q$,'gilberto-chamados'),
('ehs','EHS-04','/dashboard/compliance/funcionarios','Anexar documento do funcionário','/dashboard/compliance/painel',
 'Existem documentos ativos de funcionários para o painel de vencimentos',
 $q$SELECT 1, (SELECT count(*) FROM compliance_documentos WHERE company_id=$1 AND ativo AND funcionario_id IS NOT NULL)::int$q$,'gilberto-chamados')
ON CONFLICT (vertical, codigo) DO NOTHING;
