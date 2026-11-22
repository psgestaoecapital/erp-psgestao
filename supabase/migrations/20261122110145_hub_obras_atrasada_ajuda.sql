-- Blueprint Hub §310/§314 ("bloco de obras": ativas, concluídas, atrasadas) · RD-95: "?" do selo
-- "Atrasada" no card da lista de obras. Aditiva: só 1 linha de ajuda (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
('projetos.obras.atrasada','/dashboard/projetos/obras','Obras','hub_projetos',40,'Obra atrasada','Selo calculado, não se preenche. Aparece quando a obra está em andamento (ou pausada) e a data prevista de término já passou.','Aponta de relance as obras que furaram o prazo e precisam de replanejamento ou nova data de entrega.','Venceu em 10/09 e a obra segue em andamento','Deixar a data prevista de término desatualizada: a obra fica marcada como atrasada sem estar.')
ON CONFLICT (chave) DO NOTHING;
