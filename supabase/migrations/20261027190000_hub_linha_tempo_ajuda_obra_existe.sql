-- PDCA Hub (auditor 27/10, residuais de obras/cockpit) · aditiva, só objetos NOVOS.
-- 1) RD-95: "?" da linha do tempo da obra (/dashboard/projetos/obras/[id]/linha-do-tempo), que estava com zero ajuda.
-- 2) fn_obra_existe: o cockpit por obra diferencia "obra não existe" de "sem acesso nesta empresa" (hoje cai numa msg genérica).
--    SECURITY DEFINER só devolve booleanos (existe, tem_acesso) — nunca dado da obra; exige usuário logado.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
('projetos.linha_tempo.contratado','/dashboard/projetos/obras/[id]/linha-do-tempo','Cabeçalho','hub_projetos',1,'Contratado','Indicador calculado, não se preenche. É o valor total previsto no orçamento aprovado da obra.','Referência para comparar com o que já foi medido: a diferença é o que ainda falta faturar.','R$ 120.000,00','Confundir com o valor já recebido: contratado é o combinado, não o que entrou no caixa.'),
('projetos.linha_tempo.medido','/dashboard/projetos/obras/[id]/linha-do-tempo','Cabeçalho','hub_projetos',2,'Medido','Indicador calculado, não se preenche. Soma das medições lançadas (por NFS-e autorizada) menos as estornadas.','Mostra o avanço financeiro real da obra frente ao contratado.','R$ 45.000,00 de R$ 120.000,00','Esperar que suba sem NFS-e: medição só entra quando a nota é autorizada.'),
('projetos.linha_tempo.centro_custo','/dashboard/projetos/obras/[id]/linha-do-tempo','Cabeçalho','hub_projetos',3,'Centro de custo','Indicador, não se preenche. Mostra o número da obra quando ela já tem centro de custo vinculado; "—" quando não tem.','É por ele que custos e viagens são atribuídos à obra no resultado.','OB-004','Lançar custo sem centro de custo: ele não aparece no resultado da obra.'),
('projetos.linha_tempo.tempo_fase','/dashboard/projetos/obras/[id]/linha-do-tempo','Fases','hub_projetos',4,'Tempo por fase','Indicador calculado, não se preenche. Cada marco é o primeiro evento da fase; "+Nd" é o intervalo desde a fase anterior.','Mostra onde o negócio demora mais (do contato à medição) para você agir no gargalo.','Orçamento +12d → Obra','Ler como duração da fase inteira: é o tempo até ela começar.'),
('projetos.linha_tempo.ciclo_total','/dashboard/projetos/obras/[id]/linha-do-tempo','Fases','hub_projetos',5,'Ciclo total','Indicador calculado, não se preenche. Dias entre o primeiro e o último evento registrado.','Mede a velocidade do negócio inteiro, da oportunidade ao último evento.','Ciclo total: 48 dias','Comparar obras antigas: as criadas antes do histórico têm ciclo menor que o real.'),
('projetos.linha_tempo.filtro_fase','/dashboard/projetos/obras/[id]/linha-do-tempo','Filtro','hub_projetos',6,'Filtro por fase','Clique em uma fase para ver só os eventos dela; "Tudo" mostra a história completa.','Ajuda a achar rápido um evento (ex.: só as medições).','Medição (3)','Achar que o evento sumiu: confira se o filtro está em "Tudo".'),
('projetos.linha_tempo.evento','/dashboard/projetos/obras/[id]/linha-do-tempo','Eventos','hub_projetos',7,'Evento da linha do tempo','Registro automático, não se preenche. Cada cartão mostra a fase, data e hora, o que aconteceu e quem fez.','É o histórico de auditoria da obra: oportunidade, visita, orçamento, obra e medições em ordem.','Medição pela NFS-e nº 123 · R$ 15.000,00','Procurar edição manual: o histórico não é editável, nasce das ações no sistema.')
ON CONFLICT (chave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_obra_existe(p_obra_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('existe', false, 'tem_acesso', false); END IF;
  SELECT company_id INTO v_company FROM projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('existe', false, 'tem_acesso', false); END IF;
  RETURN jsonb_build_object('existe', true, 'tem_acesso', v_company IN (SELECT get_user_company_ids()));
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_existe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_existe(uuid) TO authenticated;
