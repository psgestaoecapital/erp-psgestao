-- PDCA Hub (auditor_pdca_1, 06/11) · chamado Tryo #3270 · RD-95: "?" da coluna Orçamentista
-- e do filtro "Meus orçamentos" na lista de Propostas do Hub.
-- 100% ADITIVA: só INSERT em erp_ajuda_campo (ON CONFLICT DO NOTHING). Não altera dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.propostas.orcamentista','Propostas','Orçamentista','Quem é responsável pelo orçamento. O nome vem do orçamento (editor) — aqui a lista só mostra.','Deixa claro de quem é cada proposta, para cobrar, revisar e dar sequência sem dúvida de dono.','Ana Souza','Orçamento sem orçamentista fica "sem dono": defina o responsável no editor do orçamento.',22,'/dashboard/projetos/propostas','hub','publicado'),
('projetos.propostas.filtro_meus','Propostas','Meus orçamentos','Botão que liga/desliga. Ligado, mostra só as propostas em que você é o orçamentista.','Foca a sua lista nos orçamentos que são seus, sem rolar os dos colegas.','Ligar para ver só os seus; desligar para ver todos.','Esquecer o botão ligado e achar que sumiram propostas — é só o filtro. Desligue para ver todas.',23,'/dashboard/projetos/propostas','hub','publicado')
ON CONFLICT (chave) DO NOTHING;
