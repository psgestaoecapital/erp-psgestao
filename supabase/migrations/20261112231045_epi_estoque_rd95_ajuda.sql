-- Compliance · EPI — Estoque (/dashboard/compliance/epi/estoque) · RD-95
-- A subtela de Estoque de EPI não tinha nenhum "?" (AjudaCampo). Esta migration (ADITIVA, idempotente,
-- NÃO altera dado de cliente) cadastra as chaves de ajuda do filtro, da ação de entrada, do seletor de
-- empresa-alvo e de todas as colunas da lista. O front passa a renderizar o "?" com estas chaves.
-- Faixa de migration do desenvolvedor_4_g (segundos :45), acima da main.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/compliance/epi/estoque', 'compliance', 'publicado'
FROM (VALUES
 ('compliance.epi.estoque.empresa_alvo','Controles','Empresa-alvo (para entradas)','Quando você vê mais de uma empresa, escolha para qual delas a entrada de estoque será lançada.','Garante que o EPI entre no estoque da empresa certa quando há várias na visão.','Selecione "Obra Centro" antes de dar entrada em 50 luvas.','Dar entrada com a empresa errada selecionada: o saldo aparece na empresa que não comprou.',1),
 ('compliance.epi.estoque.busca','Controles','Buscar no estoque','Digite parte do nome do EPI, do número do CA ou da localização para filtrar a lista.','Encontra rápido um item sem rolar a tabela inteira.','Digite "luva" ou "CA 12345" ou "Almoxarifado".','Buscar pelo nome do fornecedor: a busca é por EPI, CA ou localização.',2),
 ('compliance.epi.estoque.nav_entrada','Controles','+ Entrada de Estoque','Clique para registrar a chegada de EPIs ao estoque (compra, devolução ou acerto).','Aumenta o saldo disponível do EPI na localização informada.','Entrada de 50 pares de luva no Almoxarifado Sede.','Esquecer de dar entrada: na hora da entrega o saldo fica zerado.',3),
 ('compliance.epi.estoque.col_epi','Colunas','EPI','Nada a preencher: nome do equipamento e, quando houver, o lote do catálogo.','Identifica qual EPI a linha controla.','"Luva nitrílica" · Lote: 2026-A.','Dois EPIs de nome parecido: confira o CA para não trocar.',4),
 ('compliance.epi.estoque.col_ca','Colunas','CA','Nada a preencher: número do Certificado de Aprovação (CA) do EPI.','Comprova que o EPI é homologado pelo Ministério do Trabalho (NR-6).','CA 12345.','CA vencido/ausente: o EPI não vale para fins legais.',5),
 ('compliance.epi.estoque.col_localizacao','Colunas','Localização','Nada a preencher: onde o EPI está guardado.','Separa o saldo por depósito/almoxarifado — o mesmo EPI pode ter saldo em locais diferentes.','"Almoxarifado Sede" e "Obra Centro".','Misturar locais: o saldo de um depósito não serve para outro.',6),
 ('compliance.epi.estoque.col_empresa','Colunas','Empresa','Nada a preencher: empresa dona do saldo (aparece só quando você vê mais de uma).','Mostra de qual empresa é cada linha na visão consolidada.','"Obra Centro".','—',7),
 ('compliance.epi.estoque.col_disponivel','Colunas','Disponível','Nada a preencher: quantidade em mãos, pronta para entregar.','É o saldo que o sistema usa para alertar falta e permitir a entrega.','30 pares disponíveis.','Disponível baixo perto do mínimo: planeje a reposição.',8),
 ('compliance.epi.estoque.col_reservada','Colunas','Reservada','Nada a preencher: quantidade já comprometida (reservada), que não entra no disponível.','Evita prometer o mesmo EPI duas vezes.','5 reservados para uma entrega agendada.','Confundir reservada com disponível: reservada não está livre.',9),
 ('compliance.epi.estoque.col_minima','Colunas','Mínima','Nada a preencher: saldo mínimo de alerta configurado para o item (edite em "Editar mínimo").','Dispara o alerta de estoque baixo/crítico quando o disponível chega perto dela.','Mínimo 10: abaixo disso o item vira alerta.','Mínimo 0: o item nunca alerta e pode faltar sem aviso.',10),
 ('compliance.epi.estoque.col_status','Colunas','Status','Nada a preencher: sinal de saúde do saldo — normal, alerta ou crítico — calculado contra o mínimo.','Mostra de relance o que precisa de reposição.','"crítico" quando o disponível fica em metade do mínimo ou menos.','Ignorar "alerta": ele vira "crítico" se o saldo cair mais.',11),
 ('compliance.epi.estoque.col_acoes','Colunas','Ações','Nada a preencher: aqui ficam as ações da linha, como "Editar mínimo" de alerta.','Ajusta o mínimo de alerta sem sair da lista.','Clique em "Editar mínimo" para mudar de 5 para 10.','Mudar o mínimo não altera o saldo disponível — só o gatilho do alerta.',12)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
