-- Hub · Obras (/dashboard/projetos/obras) — CRUD completo no card (RD-98 p2/p4) + "?" (RD-95) dos resultados.
-- Motivo (auditor aud8 28/10): o card só tinha Concluir/Pausar. Agora: Editar (dados da obra) e Excluir RASTREÁVEL
-- (soft-delete: deleted_at + deleted_by + motivo + audit_log_global; a listagem e os KPIs filtram deleted_at; nunca DELETE físico).
-- Aditiva: colunas novas anuláveis, 2 funções novas, "?" novos. CREATE OR REPLACE só de fn_obras_listar/fn_obras_kpis
-- (mesma assinatura e colunas; acrescenta o filtro deleted_at IS NULL) — por isso a PR leva revisao-eng-chefe.
-- Não apaga nem altera dado de cliente; excluir é recusado se a obra já tem NFS-e autorizada ou medição.

ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_motivo text;

CREATE INDEX IF NOT EXISTS idx_projetos_obras_ativas ON public.projetos_obras (company_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_obras_listar(p_company_ids uuid[], p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, numero text, nome text, cliente_nome text, status text, valor_previsto numeric, pct_conclusao integer, cidade text, uf text, responsavel_nome text, data_inicio date, data_prevista_fim date, data_conclusao date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, o.numero, o.nome, o.cliente_nome, o.status, o.valor_previsto, o.pct_conclusao,
         o.cidade, o.uf, o.responsavel_nome, o.data_inicio, o.data_prevista_fim, o.data_conclusao
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids) AND o.company_id IN (SELECT get_user_company_ids())
     AND o.deleted_at IS NULL
     AND (p_status IS NULL OR o.status = p_status)
   ORDER BY CASE o.status WHEN 'em_andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'concluida' THEN 2 ELSE 3 END,
     o.data_inicio DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.fn_obras_kpis(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'em_andamento',       count(*) FILTER (WHERE status='em_andamento'),
    'concluidas',         count(*) FILTER (WHERE status='concluida'),
    'pausada',            count(*) FILTER (WHERE status='pausada'),
    'cancelada',          count(*) FILTER (WHERE status='cancelada'),
    'valor_em_andamento', COALESCE(sum(valor_previsto) FILTER (WHERE status='em_andamento'),0),
    'valor_concluido',    COALESCE(sum(valor_previsto) FILTER (WHERE status='concluida'),0))
  FROM public.projetos_obras WHERE company_id = ANY(p_company_ids) AND company_id IN (SELECT get_user_company_ids())
    AND deleted_at IS NULL;
$function$;

-- Editar: só aplica as chaves que vieram em p_dados (ausente = não mexe; texto vazio = limpa o campo opcional).
CREATE OR REPLACE FUNCTION public.fn_obra_editar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.projetos_obras%ROWTYPE; v_nome text; v_valor numeric;
BEGIN
  SELECT * INTO v_o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF NOT (v_o.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF p_dados ? 'nome' THEN
    v_nome := NULLIF(btrim(p_dados->>'nome'), '');
    IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome da obra.'); END IF;
  ELSE v_nome := v_o.nome; END IF;
  IF p_dados ? 'valor_previsto' THEN
    v_valor := NULLIF(btrim(p_dados->>'valor_previsto'), '')::numeric;
    IF v_valor IS NULL OR v_valor < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'O valor previsto não pode ser negativo.'); END IF;
  ELSE v_valor := v_o.valor_previsto; END IF;

  UPDATE public.projetos_obras SET
    nome              = v_nome,
    valor_previsto    = v_valor,
    cliente_nome      = CASE WHEN p_dados ? 'cliente_nome'     THEN NULLIF(btrim(p_dados->>'cliente_nome'), '')     ELSE cliente_nome END,
    responsavel_nome  = CASE WHEN p_dados ? 'responsavel_nome' THEN NULLIF(btrim(p_dados->>'responsavel_nome'), '') ELSE responsavel_nome END,
    cidade            = CASE WHEN p_dados ? 'cidade'           THEN NULLIF(btrim(p_dados->>'cidade'), '')           ELSE cidade END,
    uf                = CASE WHEN p_dados ? 'uf'               THEN NULLIF(upper(btrim(p_dados->>'uf')), '')        ELSE uf END,
    observacoes       = CASE WHEN p_dados ? 'observacoes'      THEN NULLIF(btrim(p_dados->>'observacoes'), '')      ELSE observacoes END,
    data_inicio       = CASE WHEN p_dados ? 'data_inicio'      THEN NULLIF(p_dados->>'data_inicio', '')::date       ELSE data_inicio END,
    data_prevista_fim = CASE WHEN p_dados ? 'data_prevista_fim' THEN NULLIF(p_dados->>'data_prevista_fim', '')::date ELSE data_prevista_fim END,
    updated_at        = now()
  WHERE id = p_obra_id;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_o.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()), 'projetos_obras', v_o.id::text, 'EDITOU',
            jsonb_build_object('nome', v_o.nome, 'cliente_nome', v_o.cliente_nome, 'responsavel_nome', v_o.responsavel_nome, 'valor_previsto', v_o.valor_previsto,
                               'data_inicio', v_o.data_inicio, 'data_prevista_fim', v_o.data_prevista_fim, 'cidade', v_o.cidade, 'uf', v_o.uf),
            p_dados);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Excluir rastreável: soft-delete com motivo obrigatório. Recusa obra com NFS-e autorizada ou medição (histórico fiscal/financeiro).
CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_o public.projetos_obras%ROWTYPE; v_motivo text := NULLIF(btrim(p_motivo), '');
BEGIN
  SELECT * INTO v_o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF NOT (v_o.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_motivo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão.'); END IF;
  IF COALESCE(v_o.valor_medido, 0) > 0 OR EXISTS (SELECT 1 FROM public.erp_nfse_emitidas n WHERE n.obra_id = v_o.id AND n.status = 'autorizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta obra já tem medição ou NFS-e autorizada — não pode ser excluída. Use "Cancelar" para encerrá-la mantendo o histórico.');
  END IF;

  UPDATE public.projetos_obras SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = v_motivo, updated_at = now()
   WHERE id = p_obra_id;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_o.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()), 'projetos_obras', v_o.id::text, 'EXCLUIU',
            jsonb_build_object('numero', v_o.numero, 'nome', v_o.nome, 'status', v_o.status, 'valor_previsto', v_o.valor_previsto),
            jsonb_build_object('acao', 'soft_delete', 'motivo', v_motivo));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'numero', v_o.numero);
END $function$;

-- Leitura também é SECURITY DEFINER e recebe p_company_ids do chamador: sem REVOKE o PostgREST expõe a anon
-- (listaria obras/KPIs de qualquer empresa, vazamento entre tenants — RD-79/RD-97). Revoga anon, mantém authenticated.
REVOKE ALL ON FUNCTION public.fn_obras_listar(uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obras_kpis(uuid[])         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_listar(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obras_kpis(uuid[])         TO authenticated;

REVOKE ALL ON FUNCTION public.fn_obra_editar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_editar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_excluir(uuid, text) TO authenticated;

-- "?" (RD-95): colunas do resultado do card, ações Editar/Excluir e campos do formulário de edição.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.obras.res_faturado', 'Resultado', 'Faturado', 'Nada a preencher: soma das NFS-e autorizadas ligadas a esta obra.', 'Mostra quanto já foi cobrado do cliente por esta obra.', 'Duas notas de R$ 10.000 autorizadas = Faturado R$ 20.000.', 'Nota ainda em rascunho ou rejeitada não entra: só conta a autorizada.', 40),
 ('projetos.obras.res_recebido', 'Resultado', 'Recebido', 'Nada a preencher: soma das baixas dos títulos gerados pelas notas desta obra.', 'Mostra quanto do faturado o cliente já pagou.', 'Faturado R$ 20.000 e uma nota de R$ 10.000 paga = Recebido R$ 10.000.', 'Nota sem título no financeiro não entra no recebido — o aviso abaixo do card conta quantas.', 41),
 ('projetos.obras.res_a_receber', 'Resultado', 'A receber', 'Nada a preencher: saldo em aberto dos títulos das notas desta obra.', 'Mostra quanto ainda falta o cliente pagar.', 'Título de R$ 10.000 com R$ 4.000 pagos = A receber R$ 6.000.', 'Achar que é previsão de medição: aqui só entra o que já foi faturado.', 42),
 ('projetos.obras.res_custo', 'Resultado', 'Custo', 'Nada a preencher: custo real lançado na obra (material + viagens).', 'Compara com o faturado para saber se a obra dá lucro. Traço (—) ou R$ 0 = ainda não há custo lançado.', 'Material R$ 3.000 + viagens R$ 500 = Custo R$ 3.500.', 'Ler R$ 0 como obra sem gasto: pode ser só que ninguém lançou o custo ainda.', 43),
 ('projetos.obras.acao_editar', 'Ações', 'Editar obra', 'Toque para alterar nome, cliente, responsável, valor previsto, datas, cidade/UF e observações.', 'Corrige os dados da obra sem recriá-la; cada alteração fica registrada (quem e quando).', 'Trocar o responsável de "—" para "Carlos Lima".', 'Procurar CNO/endereço fiscal aqui: eles ficam em "Dados fiscais".', 44),
 ('projetos.obras.acao_excluir', 'Ações', 'Excluir obra', 'Toque, informe o motivo e confirme. A obra sai da lista, mas o registro é guardado (quem excluiu, quando e por quê).', 'Remove obra criada por engano sem perder o rastro de auditoria.', 'Motivo: "Obra cadastrada em duplicidade".', 'Tentar excluir obra com medição ou NFS-e: use Cancelar para manter o histórico.', 45),
 ('projetos.obras.edit_nome', 'Edição', 'Nome da obra', 'Nome pelo qual a equipe reconhece a obra.', 'Aparece em listas, cockpit e relatórios.', 'Reforma Loja Centro', 'Deixar em branco — o nome é obrigatório.', 46),
 ('projetos.obras.edit_cliente', 'Edição', 'Cliente', 'Nome do cliente dono da obra.', 'Agrupa e filtra as obras por cliente.', 'Construtora Horizonte', 'Escrever o nome de forma diferente em cada obra — dificulta o filtro.', 47),
 ('projetos.obras.edit_responsavel', 'Edição', 'Responsável', 'Nome de quem responde pela obra (engenheiro ou gestor).', 'Mostra no card quem cobrar pelo andamento.', 'Carlos Lima', 'Deixar "sem responsável": ninguém sabe a quem perguntar.', 48),
 ('projetos.obras.edit_valor', 'Edição', 'Valor previsto (R$)', 'Valor total contratado/previsto da obra, em reais.', 'Alimenta os indicadores "Valor em andamento" e "Valor concluído".', '125000,00', 'Colocar o valor medido aqui — este é o valor total previsto.', 49),
 ('projetos.obras.edit_inicio', 'Edição', 'Início', 'Data em que a obra começou ou começará.', 'Ordena a lista e serve de base do cronograma.', '01/11/2026', 'Data de início depois do prazo final.', 50),
 ('projetos.obras.edit_fim', 'Edição', 'Prazo final', 'Data prevista para terminar a obra.', 'Quando passa da data sem a obra concluída, o cockpit marca "prazo vencido".', '30/03/2027', 'Esquecer de atualizar depois de um replanejamento.', 51),
 ('projetos.obras.edit_local', 'Edição', 'Cidade / UF', 'Cidade e estado onde a obra acontece.', 'Aparece no card e ajuda na busca.', 'Campinas / SP', 'Usar a cidade do cliente em vez da cidade da obra.', 52),
 ('projetos.obras.edit_obs', 'Edição', 'Observações', 'Anotações livres sobre a obra.', 'Guarda combinados e avisos para quem assumir a obra depois.', 'Cliente só libera acesso após as 8h.', 'Registrar aqui valores ou datas: use os campos próprios.', 53)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
