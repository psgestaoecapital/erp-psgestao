-- "?" (RD-95) dos atalhos Cronograma / Horas / Linha do tempo no card do Cockpit. Aditiva: só linha de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.cockpit.card_atalhos','Cockpit','Atalhos da obra','Nada a preencher: clique para abrir direto o cronograma, as horas ou a linha do tempo daquela obra.','Chega ao que importa da obra sem passar pelo cockpit completo.','Horas','Esperar que o atalho altere a obra: ele só abre a tela.',310,'/dashboard/projetos/cockpit','projetos','publicado')
ON CONFLICT (chave) DO NOTHING;
