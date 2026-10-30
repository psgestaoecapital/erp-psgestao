-- Hub · Take-off (/dashboard/projetos/takeoff) — RD-98: ações por planta (editar, excluir rastreável) + ajuda + origem do dado.
-- ADITIVA: 3 colunas novas em erp_obra_planta (deleted_at/deleted_by/motivo_exclusao) e 2 RPCs novas.
-- Excluir = soft-delete (nenhum DELETE físico): guarda quem, quando e por quê, e grava audit_log_global.
-- Planta que já gerou orçamento ('confirmada') não pode ser excluída (o orçamento já foi gerado a partir dela).
-- A busca por hash (reuso de análise paga) passa a ignorar planta excluída.

ALTER TABLE public.erp_obra_planta
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS motivo_exclusao text;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_excluir(p_planta_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p public.erp_obra_planta%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.erp_obra_planta WHERE id = p_planta_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Planta não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(p.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  IF p.status = 'confirmada' THEN
    RAISE EXCEPTION 'Esta planta já gerou itens de orçamento e não pode ser excluída.';
  END IF;
  UPDATE public.erp_obra_planta
     SET deleted_at = now(), deleted_by = auth.uid(), motivo_exclusao = btrim(p_motivo)
   WHERE id = p_planta_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p.company_id, auth.uid(), 'erp_obra_planta', p_planta_id::text, 'excluir',
            jsonb_build_object('nome', p.nome, 'status', p.status, 'orcamento_id', p.orcamento_id),
            jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_editar(p_planta_id uuid, p_nome text, p_orcamento_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p public.erp_obra_planta%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.erp_obra_planta WHERE id = p_planta_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Planta não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(p.company_id);
  IF length(btrim(coalesce(p_nome, ''))) < 2 THEN RAISE EXCEPTION 'Informe o nome da planta.'; END IF;
  IF p_orcamento_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.erp_orcamentos o WHERE o.id = p_orcamento_id AND o.company_id = p.company_id AND o.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Orçamento de destino não encontrado nesta empresa.';
  END IF;
  UPDATE public.erp_obra_planta SET nome = btrim(p_nome), orcamento_id = p_orcamento_id, updated_at = now() WHERE id = p_planta_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p.company_id, auth.uid(), 'erp_obra_planta', p_planta_id::text, 'editar',
            jsonb_build_object('nome', p.nome, 'orcamento_id', p.orcamento_id),
            jsonb_build_object('nome', btrim(p_nome), 'orcamento_id', p_orcamento_id));
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_takeoff_planta_excluir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_takeoff_planta_editar(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_excluir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_editar(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_takeoff_planta_procurar_por_hash(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_procurar_por_hash(uuid, text) TO authenticated, service_role;

-- Reuso por hash ignora planta excluída (senão reenviar o mesmo arquivo "ressuscitaria" a planta apagada).
CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_procurar_por_hash(p_company_id uuid, p_arquivo_hash text)
 RETURNS TABLE(id uuid, nome text, aps_status text, analisado_em timestamp with time zone, arquivo_dwg_path text, arquivo_path text, arquivo_tipo text, orcamento_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_arquivo_hash IS NULL OR length(p_arquivo_hash) < 16 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.nome, p.aps_status, p.analisado_em,
         p.arquivo_dwg_path, p.arquivo_path, p.arquivo_tipo, p.orcamento_id
    FROM public.erp_obra_planta p
   WHERE p.company_id = p_company_id
     AND p.arquivo_hash = p_arquivo_hash
     AND p.deleted_at IS NULL
   ORDER BY
     (CASE p.aps_status
        WHEN 'radiografado' THEN 1
        WHEN 'traduzindo'   THEN 2
        ELSE                     3 END),
     p.updated_at DESC
   LIMIT 1;
END $function$;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_obra_planta', 'erp_obra_planta_ambiente', 'erp_orcamentos', 'projetos_servicos'],
       rpcs_chamadas = ARRAY['fn_takeoff_planta_salvar', 'fn_takeoff_planta_procurar_por_hash', 'fn_takeoff_ambiente_atualizar', 'fn_takeoff_ambiente_criar_manual', 'fn_takeoff_gerar_orcamento', 'fn_takeoff_criar_orcamento', 'fn_takeoff_planta_editar', 'fn_takeoff_planta_excluir']
 WHERE rota = '/dashboard/projetos/takeoff';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.takeoff.acoes', '/dashboard/projetos/takeoff', 'Plantas enviadas', 'Ações da planta',
   'Em cada planta: Abrir continua de onde parou, Ver orçamento abre o orçamento gerado, Re-analisar roda a IA/CAD de novo, Editar muda nome e orçamento de destino, Excluir tira da lista com motivo.', 'Resolve tudo da planta sem sair da lista.', 'Re-analisar depois de trocar a escala', 'Re-analisar DWG consome 1 crédito de CAD; a tela pede confirmação.', 'hub', 970, 1, 'publicado'),
  ('projetos.takeoff.planta_progresso', '/dashboard/projetos/takeoff', 'Plantas enviadas', 'Etapa da planta',
   'Mostra em qual das 6 etapas do take-off cada planta está (enviar, analisar, revisar, vincular, escolher orçamento, gerar).', 'Você vê de relance quais plantas faltam revisar e quais já viraram orçamento.', 'Etapa 3 de 6: Revisar medidas', 'Achar que "Aguardando análise" é erro: só falta clicar em Analisar.', 'hub', 971, 1, 'publicado'),
  ('projetos.takeoff.planta_editar', '/dashboard/projetos/takeoff', 'Plantas enviadas', 'Editar planta',
   'Nome da planta e orçamento de destino dos itens.', 'Corrige o nome e muda para qual orçamento os ambientes serão enviados.', 'Residencial Vista Verde — Torre B', 'Deixar o nome em branco: não é aceito.', 'hub', 972, 1, 'publicado'),
  ('projetos.takeoff.planta_excluir', '/dashboard/projetos/takeoff', 'Plantas enviadas', 'Excluir planta',
   'Tira a planta da lista, informando o motivo. Não apaga: guarda quem excluiu, quando e por quê.', 'Limpa envios duplicados ou errados sem perder o histórico.', 'Arquivo enviado por engano', 'Planta que já gerou itens de orçamento não pode ser excluída.', 'hub', 973, 1, 'publicado'),
  ('projetos.takeoff.motivo_exclusao', '/dashboard/projetos/takeoff', 'Plantas enviadas', 'Motivo da exclusão',
   'Por que a planta está sendo excluída (mínimo 3 letras).', 'Fica na auditoria da planta.', 'planta duplicada', 'Deixar em branco: a exclusão não é aceita.', 'hub', 974, 1, 'publicado'),
  ('projetos.takeoff.planta_nome', '/dashboard/projetos/takeoff', 'Plantas enviadas', 'Nome da planta',
   'Como a planta aparece na lista e nas análises salvas.', 'Facilita achar a planta depois.', 'Clínica Bem Viver — pavimento 1', 'Usar só o nome do arquivo (ex.: final_v3.pdf).', 'hub', 975, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
