-- Núcleo · Cadastro de Clientes (/dashboard/clientes) · PDCA aud8claudeps 09/11 (65/95)
-- Gaps: RD-95 (0 "?"), RD-98 p2 (sem Excluir), p4 (lista não filtra excluídos / sem restaurar), p3 (origem do dado).
-- Esta migration (ADITIVA, idempotente, não altera dado de cliente):
--   1) fn_cliente_restaurar: desfaz o arquivamento (par do fn_cliente_arquivar já existente) — guardada, com audit.
--   2) Chaves de ajuda "?" (RD-95) dos KPIs, filtros, colunas e ações da tela.
--   3) system_screens: origem do dado (RD-98 p3).
-- Faixa de migration do code-desenvolvedor-3 (segundos :42), acima da main.

-- 1) Restaurar cliente arquivado (soft-undelete rastreável) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cliente_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para restaurar'); END IF;
  SELECT company_id, COALESCE(NULLIF(nome_fantasia,''), razao_social)
    INTO v_company, v_nome
    FROM public.erp_clientes WHERE id = p_id AND excluido_em IS NOT NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cliente não encontrado ou não está excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_clientes
     SET ativo = true, excluido_em = NULL, excluido_por = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_clientes', p_id, 'restaurar',
            jsonb_build_object('ativo', false, 'excluido', true),
            jsonb_build_object('ativo', true, 'nome', v_nome, 'restaurado_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cliente_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_restaurar(uuid) TO authenticated;

-- 2) RD-95 "?" (idempotente) ───────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/clientes', 'nucleo', 'publicado'
FROM (VALUES
 ('clientes.kpi.ativos','Indicadores','Clientes Ativos','Nada a preencher: é a contagem de clientes com cadastro ativo (não excluídos nem inativados).','Mostra o tamanho da sua carteira de clientes em uso.','Se você tem 48 clientes ativos, aparece 48.','Confundir com total de cadastros: excluídos e inativos não entram aqui.',1),
 ('clientes.kpi.vip','Indicadores','Clientes VIP','Nada a preencher: conta os clientes marcados com a etiqueta VIP.','Destaca quantos clientes têm tratamento prioritário.','3 clientes com a tag VIP.','Esperar que seja automático: VIP é a etiqueta que você aplica no cadastro.',2),
 ('clientes.kpi.risco_alto','Indicadores','Risco Alto','Nada a preencher: conta os clientes com classificação de risco ALTO.','Alerta rápido de quantos clientes exigem cautela de crédito.','2 clientes em risco alto.','Ignorar: risco alto pede atenção antes de liberar limite/venda a prazo.',3),
 ('clientes.kpi.limite_total','Indicadores','Limite Total','Nada a preencher: soma o limite de crédito concedido a todos os clientes.','Mostra quanto de crédito você tem exposto na carteira.','R$ 120.000,00 de limite somado.','Confundir com valor já usado: isto é o teto concedido, não o utilizado.',4),
 ('clientes.kpi.utilizado','Indicadores','Utilizado','Nada a preencher: soma o crédito já utilizado pelos clientes.','Mostra quanto do limite concedido já está comprometido.','R$ 84.000,00 em uso de um limite de R$ 120.000,00.','Ler como disponível: aqui é o que JÁ foi usado, não o que sobra.',5),
 ('clientes.filtro.busca','Filtros','Buscar','Digite parte do nome, razão, CNPJ/CPF, e-mail ou cidade do cliente.','Encontra rapidamente um cliente sem rolar a lista inteira.','Digite "Ferragens" ou "12.345" para achar pelo nome ou CNPJ.','Digitar o CNPJ com pontos e não achar: a busca ignora a pontuação.',6),
 ('clientes.filtro.risco','Filtros','Risco','Escolha uma classificação de risco (Baixo, Médio, Alto) ou Todos.','Filtra a lista para focar num nível de risco de crédito.','Clique em "🔴 Alto" para ver só os clientes de risco alto.','Esquecer de voltar para "Todos" e achar que sumiram clientes.',7),
 ('clientes.filtro.status','Filtros','Situação','Escolha Ativos, Inativos, Bloqueados, Excluídos ou Todos.','Separa clientes em uso dos inativados, bloqueados ou excluídos (arquivados).','"🗑 Excluídos" mostra os arquivados, com a opção Restaurar.','Procurar um cliente excluído na aba Ativos: ele só aparece em Excluídos.',8),
 ('clientes.col.razao','Colunas','Razão / Fantasia','Nada a preencher: mostra o nome fantasia (ou a razão social) do cliente.','Identifica o cliente na lista.','"Ferragens Silva" (fantasia) com "Silva Comércio LTDA" (razão) abaixo.','—',9),
 ('clientes.col.cnpj','Colunas','CNPJ / CPF','Nada a preencher: documento do cliente, formatado.','Confere identidade fiscal do cliente.','12.345.678/0001-90.','"—" significa que o documento não foi cadastrado, não que é erro.',10),
 ('clientes.col.cidade','Colunas','Cidade/UF','Nada a preencher: cidade e estado do cliente.','Localiza o cliente geograficamente.','Caxias do Sul/RS.','—',11),
 ('clientes.col.risco','Colunas','Risco','Nada a preencher: classificação de risco de crédito do cliente.','Sinaliza a cautela recomendada antes de vender a prazo.','🟢 BAIXO, 🟡 MÉDIO, 🔴 ALTO ou ⚪ NOVO.','Vender a prazo para 🔴 ALTO sem analisar.',12),
 ('clientes.col.limite','Colunas','Limite','Nada a preencher: limite de crédito concedido ao cliente.','Mostra o teto de crédito daquele cliente.','R$ 5.000,00; "—" quando não há limite definido.','Liberar venda a prazo acima do limite sem revisar.',13),
 ('clientes.col.tags','Colunas','Etiquetas','Nada a preencher: etiquetas aplicadas ao cliente (VIP, etc.).','Agrupa e destaca clientes por características suas.','VIP, Atacado.','—',14),
 ('clientes.col.acoes','Colunas','Ações','Nada a preencher: botões de ação do cliente (WhatsApp, e-mail, Editar, Bloquear, Excluir).','Permite agir sobre o cliente direto da lista.','Clique em Editar para abrir o cadastro.','Excluir sem querer: há confirmação, e o excluído pode ser restaurado.',15),
 ('clientes.acao.importar','Ações','Importar','Clique para trazer clientes de uma planilha ou de um conector.','Cadastra muitos clientes de uma vez, sem digitar um a um.','Importe um Excel/CSV com a lista de clientes.','Importar duplicado: confira se o cliente já não existe.',16),
 ('clientes.acao.novo','Ações','+ Novo','Clique para cadastrar um novo cliente manualmente.','Abre o formulário de cadastro com busca de CNPJ e CEP.','+ Novo para cadastrar "Ferragens Silva".','—',17),
 ('clientes.acao.editar','Ações','Editar','Clique para abrir e alterar o cadastro do cliente.','Mantém os dados do cliente atualizados.','Editar para corrigir o telefone.','—',18),
 ('clientes.acao.bloquear','Ações','Bloquear / Desbloquear','Clique para bloquear (ou liberar) o cliente para novas vendas.','Impede vendas a um cliente sem excluí-lo do cadastro.','Bloqueie um cliente inadimplente; desbloqueie ao regularizar.','Confundir com Excluir: bloquear mantém o cadastro e o histórico.',19),
 ('clientes.acao.excluir','Ações','Excluir','Clique para excluir (arquivar) o cliente. Pede confirmação.','Tira o cliente da lista ativa sem apagar o histórico — é reversível.','Excluir um cadastro duplicado.','Achar que some para sempre: o excluído fica em "🗑 Excluídos" e pode ser restaurado.',20),
 ('clientes.acao.restaurar','Ações','Restaurar','Clique, na aba Excluídos, para trazer o cliente de volta à lista ativa.','Desfaz uma exclusão feita por engano.','Restaurar um cliente arquivado sem querer.','—',21)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 3) RD-98 p3 · origem do dado da tela ─────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_clientes']::text[],
       rpcs_chamadas   = ARRAY['fn_cliente_arquivar','fn_cliente_restaurar','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/clientes';
