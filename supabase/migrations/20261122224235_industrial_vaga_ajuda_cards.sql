-- GAPS auditor /dashboard/industrial/vagas · RD-95: os cards de indicador "Aprovadas" e "Recusadas"
-- não tinham "?". Acrescenta as 2 chaves de ajuda (o card "Em análise" já usa industrial.vaga.resumo).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING); não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
('industrial.vaga.aprovadas','/dashboard/industrial/vagas','Indicadores','industrial',20,'Vagas aprovadas','Indicador automático: não se preenche. Soma a quantidade de pessoas das vagas já aprovadas (reposição entra aprovada direto; criação acima do quadro entra depois do aval da diretoria).','Mostra, de relance, quantas posições já estão liberadas para contratar — a base do que RH precisa preencher.','3 posições aprovadas no setor de Desossa','Confundir "aprovadas" com "já contratadas": o indicador conta o que foi liberado, não quem já foi admitido.'),
('industrial.vaga.recusadas','/dashboard/industrial/vagas','Indicadores','industrial',30,'Vagas recusadas','Indicador automático: não se preenche. Soma a quantidade de pessoas das vagas recusadas na análise.','Mostra quantas solicitações de vaga foram negadas, ajudando a rever o planejamento do quadro.','2 posições recusadas por estarem acima do orçamento','Esperar que uma vaga recusada volte sozinha: é preciso abrir uma nova solicitação com justificativa.')
ON CONFLICT (chave) DO NOTHING;
