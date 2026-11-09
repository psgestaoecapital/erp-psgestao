-- Núcleo · Cadastro de Fornecedores (/dashboard/fornecedores) · PDCA aud8claudeps 09/11 (65/95)
-- Gaps: RD-95 (0 "?"), RD-98 p2 (sem Excluir), p4 (sem soft-delete/restaurar + lista não filtra), p3 (origem).
-- Esta migration (ADITIVA, idempotente, não altera dado de cliente):
--   1) Soft-delete em erp_fornecedores: colunas excluido_em / excluido_por (NULL por padrão — nada muda nas linhas atuais).
--   2) fn_fornecedor_arquivar / fn_fornecedor_restaurar: guardadas (auth + empresa), com audit. Nunca DELETE físico.
--   3) Chaves de ajuda "?" (RD-95) dos KPIs, filtros, colunas e ações.
--   4) system_screens: origem do dado (RD-98 p3).
-- Faixa de migration do code-desenvolvedor-3 (segundos :43), acima da main.

-- 1) Soft-delete (aditivo) ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_fornecedores
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Arquivar / Restaurar (soft-delete rastreável) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_fornecedor_arquivar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, COALESCE(NULLIF(nome_fantasia,''), razao_social) INTO v_company, v_nome
    FROM public.erp_fornecedores WHERE id = p_id AND excluido_em IS NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Fornecedor não encontrado ou já excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_fornecedores
     SET ativo = false, excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_fornecedores', p_id, 'arquivar',
            jsonb_build_object('ativo', true),
            jsonb_build_object('ativo', false, 'nome', v_nome, 'excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_fornecedor_restaurar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para restaurar'); END IF;
  SELECT company_id, COALESCE(NULLIF(nome_fantasia,''), razao_social) INTO v_company, v_nome
    FROM public.erp_fornecedores WHERE id = p_id AND excluido_em IS NOT NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Fornecedor não encontrado ou não está excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_fornecedores
     SET ativo = true, excluido_em = NULL, excluido_por = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_fornecedores', p_id, 'restaurar',
            jsonb_build_object('ativo', false, 'excluido', true),
            jsonb_build_object('ativo', true, 'nome', v_nome, 'restaurado_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_fornecedor_arquivar(uuid)  FROM anon;
REVOKE ALL ON FUNCTION public.fn_fornecedor_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fornecedor_arquivar(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_fornecedor_restaurar(uuid) TO authenticated;

-- 3) RD-95 "?" (idempotente) ───────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/fornecedores', 'nucleo', 'publicado'
FROM (VALUES
 ('fornecedores.kpi.ativos','Indicadores','Fornecedores Ativos','Nada a preencher: conta os fornecedores com cadastro ativo (não excluídos).','Mostra o tamanho da sua base de fornecedores em uso.','Se você tem 30 fornecedores ativos, aparece 30.','Confundir com total: excluídos e inativos não entram.',1),
 ('fornecedores.kpi.principais','Indicadores','Principais','Nada a preencher: conta os fornecedores marcados como principais.','Destaca os parceiros estratégicos de compra.','4 fornecedores marcados com a estrela.','Esperar automático: você marca o principal na lista (⭐).',2),
 ('fornecedores.kpi.bem_avaliados','Indicadores','Bem Avaliados (4+)','Nada a preencher: conta os fornecedores com avaliação geral 4 ou mais (de 5).','Mostra quantos parceiros têm bom desempenho (qualidade/prazo/preço).','7 fornecedores com nota 4 ou 5.','Ignorar notas baixas na hora de comprar.',3),
 ('fornecedores.kpi.nota_media','Indicadores','Nota Média','Nada a preencher: média das avaliações dos fornecedores que têm nota.','Resume a qualidade média da sua base de fornecedores.','4,2★ de média.','Comparar com fornecedor sem nota: só entram na média os avaliados.',4),
 ('fornecedores.kpi.total_compras','Indicadores','Total em Compras','Nada a preencher: soma o total de compras registrado com os fornecedores.','Mostra o volume financeiro movimentado com a base.','R$ 480.000,00 em compras.','—',5),
 ('fornecedores.filtro.busca','Filtros','Buscar','Digite parte do nome, razão, CNPJ/CPF ou cidade do fornecedor.','Encontra um fornecedor rápido, sem rolar a lista.','Digite "Transportes" ou "12.345".','Digitar o CNPJ com pontos: a busca ignora a pontuação.',6),
 ('fornecedores.filtro.categoria','Filtros','Categoria','Escolha uma categoria de fornecedor ou "Todas categorias".','Filtra a lista por tipo de fornecimento.','Selecione "Matéria-prima" para ver só esses.','Esquecer de voltar para "Todas" e achar que sumiram fornecedores.',7),
 ('fornecedores.filtro.status','Filtros','Situação','Escolha Ativos, Principais, Inativos, Excluídos ou Todos.','Separa fornecedores em uso dos inativos ou excluídos (arquivados).','"🗑 Excluídos" mostra os arquivados, com a opção Restaurar.','Procurar um fornecedor excluído na aba Ativos: ele só aparece em Excluídos.',8),
 ('fornecedores.col.razao','Colunas','Razão / Fantasia','Nada a preencher: nome fantasia (ou razão social) do fornecedor; ⭐ marca o principal.','Identifica o fornecedor na lista.','"Transportes Silva".','—',9),
 ('fornecedores.col.cnpj','Colunas','CNPJ / CPF','Nada a preencher: documento do fornecedor, formatado.','Confere identidade fiscal do fornecedor.','12.345.678/0001-90.','"—" significa documento não cadastrado, não erro.',10),
 ('fornecedores.col.categoria','Colunas','Categoria','Nada a preencher: categoria de fornecimento do fornecedor.','Ajuda a agrupar e comparar fornecedores do mesmo tipo.','Matéria-prima, Serviços.','—',11),
 ('fornecedores.col.avaliacao','Colunas','Avaliação','Nada a preencher: nota geral do fornecedor (estrelas), de 1 a 5.','Mostra o desempenho avaliado (qualidade/prazo/preço).','★★★★☆ 4,0.','Comprar só pelo preço ignorando a nota.',12),
 ('fornecedores.col.prazo','Colunas','Prazo','Nada a preencher: prazo médio de entrega do fornecedor, em dias.','Ajuda a planejar a compra pelo tempo de entrega.','7d (sete dias); "—" quando não informado.','—',13),
 ('fornecedores.col.tags','Colunas','Etiquetas','Nada a preencher: etiquetas aplicadas ao fornecedor.','Agrupa e destaca fornecedores por características suas.','Homologado, Exclusivo.','—',14),
 ('fornecedores.col.acoes','Colunas','Ações','Nada a preencher: botões de ação (WhatsApp, e-mail, marcar principal, Editar, Excluir).','Permite agir sobre o fornecedor direto da lista.','Clique em Editar para abrir o cadastro.','Excluir sem querer: há confirmação, e o excluído pode ser restaurado.',15),
 ('fornecedores.acao.importar','Ações','Importar','Clique para trazer fornecedores de uma planilha ou conector.','Cadastra muitos fornecedores de uma vez.','Importe um Excel/CSV com a lista.','Importar duplicado: confira se já não existe.',16),
 ('fornecedores.acao.novo','Ações','+ Novo','Clique para cadastrar um novo fornecedor manualmente.','Abre o formulário com busca de CNPJ e CEP.','+ Novo para cadastrar "Transportes Silva".','—',17),
 ('fornecedores.acao.editar','Ações','Editar','Clique para abrir e alterar o cadastro do fornecedor.','Mantém os dados do fornecedor atualizados.','Editar para corrigir o prazo de entrega.','—',18),
 ('fornecedores.acao.principal','Ações','Principal','Clique na ⭐ para marcar/desmarcar o fornecedor como principal.','Destaca os parceiros estratégicos de compra.','Marque o fornecedor preferencial de matéria-prima.','—',19),
 ('fornecedores.acao.excluir','Ações','Excluir','Clique para excluir (arquivar) o fornecedor. Pede confirmação.','Tira o fornecedor da lista ativa sem apagar o histórico — é reversível.','Excluir um cadastro duplicado.','Achar que some para sempre: fica em "🗑 Excluídos" e pode ser restaurado.',20),
 ('fornecedores.acao.restaurar','Ações','Restaurar','Clique, na aba Excluídos, para trazer o fornecedor de volta à lista ativa.','Desfaz uma exclusão feita por engano.','Restaurar um fornecedor arquivado sem querer.','—',21)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 4) RD-98 p3 · origem do dado ─────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_fornecedores']::text[],
       rpcs_chamadas   = ARRAY['fn_fornecedor_arquivar','fn_fornecedor_restaurar','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/fornecedores';
