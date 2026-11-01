-- Hub · Obra: (1) fn_obra_existe — diferencia "obra não existe" × "sem acesso nesta empresa" no cockpit da obra;
-- (2) "?" (RD-95) da Linha do tempo da obra. SÓ ADITIVO (função nova + linhas novas em erp_ajuda_campo). Faixa 00.

CREATE OR REPLACE FUNCTION public.fn_obra_existe(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('existe', false, 'tem_acesso', false); END IF;
  SELECT company_id INTO v_company FROM projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('existe', false, 'tem_acesso', false); END IF;
  -- não revela nada da obra além de existir/acesso
  RETURN jsonb_build_object('existe', true, 'tem_acesso', v_company IN (SELECT get_user_company_ids()));
END $$;

REVOKE ALL ON FUNCTION public.fn_obra_existe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_existe(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Linha do tempo', v.rotulo, v.o_que, v.serve, v.ex, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/linha-do-tempo', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.linha_tempo.contratado','Contratado','Calculado: valor total previsto da obra, vindo do orçamento aprovado.','Mostra o tamanho do contrato; é a base para comparar com o que já foi medido.','R$ 120.000,00','Achar que muda sozinho: só muda se o escopo da obra for alterado.',10),
 ('projetos.linha_tempo.medido','Medido','Calculado: soma das medições já lançadas (inclui as vindas de NFS-e autorizada).','Mostra quanto do contrato já virou receita realizada.','R$ 36.000,00 medidos de R$ 120.000,00','Confundir medido com recebido: medido é o que foi executado e lançado, não o que já entrou no caixa.',20),
 ('projetos.linha_tempo.centro_custo','Centro de custo','Calculado: mostra o número da obra quando ela já tem centro de custo ligado.','Garante que custos e receitas da obra caiam no mesmo centro; "—" indica obra sem centro ligado.','OB-0007','Ler "—" como erro de tela: significa que o centro de custo ainda não foi ligado.',30),
 ('projetos.linha_tempo.tempo_fase','Tempo por fase','Calculado: data em que cada fase começou e os dias desde a fase anterior.','Mostra onde o negócio demora (oportunidade → levantamento → orçamento → obra → medição).','Orçamento +4d → Obra +2d','Somar os dias de fases que se sobrepõem: cada valor é contado a partir do início da fase anterior.',40),
 ('projetos.linha_tempo.ciclo_total','Ciclo total','Calculado: dias entre o primeiro e o último evento registrado.','Dá o lead time completo do negócio, da oportunidade até o evento mais recente.','Ciclo total: 38 dias','Comparar obras antigas, criadas antes do histórico: o ciclo delas começa na criação da obra.',50),
 ('projetos.linha_tempo.filtro_fase','Filtro por fase','Escolha uma fase para ver só os eventos dela; "Tudo" mostra a história completa.','Ajuda a achar um evento específico em obras com muita história.','Medição (3)','Achar que sumiu evento: o filtro só esconde, não apaga; volte para "Tudo".',60),
 ('projetos.linha_tempo.eventos','Eventos da linha do tempo','Calculado: cada cartão é um fato registrado (data, fase, descrição e quem fez).','É a trilha de auditoria da obra, da oportunidade à medição, sem edição manual.','Escopo congelado · 12 itens — 20/10 14:32 — Ana','Procurar editar um evento: a linha do tempo é só leitura.',70)
) AS v(chave, rotulo, o_que, serve, ex, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- "?" da lista de Obras: busca, filtro de situação e cabeçalhos da tabela de escopo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.serve, v.ex, v.erro, v.ordem, '/dashboard/projetos/obras', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.obras.busca','Filtros','Buscar obra','Digite parte do número, do nome, do cliente ou da cidade.','Reduz a lista às obras que combinam, sem sair da tela.','OB-0007 ou "Reforma loja"','Digitar o nome da empresa dona do sistema: a busca olha o cliente da obra.',10),
 ('projetos.obras.filtro_status','Filtros','Situação','Escolha a situação da obra: em andamento, concluída, pausada ou cancelada.','Mostra só as obras naquela situação; "Todas" volta à lista completa.','Pausadas','Achar que a obra sumiu: ela só está escondida pelo filtro.',20),
 ('projetos.obras.escopo_contratado','Escopo da obra','Contratado','Quantidade contratada do item, vinda do orçamento aprovado.','Base para saber quanto ainda falta medir.','120 m²','Alterar depois do escopo congelado: mudança de escopo exige novo aditivo.',30),
 ('projetos.obras.escopo_medido','Escopo da obra','Medido','Calculado: quantidade do item já medida (inclui a vinda de NFS-e autorizada).','Mostra o quanto do item já foi executado e lançado.','45 m²','Confundir com recebido: medido não é o que já foi pago.',40),
 ('projetos.obras.escopo_pct','Escopo da obra','% medido','Calculado: medido ÷ contratado do item.','Mostra o avanço do item de relance.','37,5%','Esperar 100% sem medir tudo: só chega lá com a quantidade total medida.',50),
 ('projetos.obras.escopo_a_medir','Escopo da obra','A medir','Calculado: contratado − medido.','Diz quanto ainda pode entrar em medição neste item.','75 m²','Tentar medir mais que o saldo: o sistema recusa para não estourar o contrato.',60),
 ('projetos.obras.escopo_valor','Escopo da obra','Valor contratado','Calculado: quantidade contratada × preço unitário do item.','Compõe o valor total da obra e o teto de faturamento do item.','R$ 18.000,00','Comparar com o preço de tabela: vale o preço fechado no orçamento.',70)
) AS v(chave, grupo, rotulo, o_que, serve, ex, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
