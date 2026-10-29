-- Hub · Propostas (/dashboard/projetos/propostas) — RD-98: exclusão rastreável (soft-delete) + origem do dado + ajuda.
-- ADITIVA: 3 colunas novas em erp_orcamentos (deleted_at/deleted_by/motivo_exclusao) e 1 RPC nova.
-- A exclusão só vale para proposta que NÃO virou negócio (rascunho, enviado, visualizado, recusado, expirado):
-- aprovada, virou pedido, venda avulsa, com obra ou com pedido é recusada (nunca toca documento que já gerou efeito).
-- Ao excluir, o status passa a 'cancelado' para as outras telas de orçamento tratarem como inativa. Nenhum DELETE físico.

ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS motivo_exclusao text;

CREATE OR REPLACE FUNCTION public.fn_proposta_excluir(p_orcamento_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.erp_orcamentos%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.erp_orcamentos WHERE id = p_orcamento_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(o.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  IF o.status NOT IN ('rascunho', 'enviado', 'visualizado', 'recusado', 'expirado') OR o.obra_id IS NOT NULL OR o.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta proposta já virou negócio (aprovada, pedido ou obra) e não pode ser excluída. Cancele pelo editor, se for o caso.';
  END IF;
  UPDATE public.erp_orcamentos
     SET deleted_at = now(), deleted_by = auth.uid(), motivo_exclusao = btrim(p_motivo), status = 'cancelado'
   WHERE id = p_orcamento_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'erp_orcamentos', p_orcamento_id::text, 'excluir',
            jsonb_build_object('numero', o.numero, 'cliente_nome', o.cliente_nome, 'status', o.status, 'total', o.total),
            jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_proposta_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proposta_excluir(uuid, text) TO authenticated, service_role;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_orcamentos', 'erp_orcamentos_itens', 'erp_crm_oportunidade', 'erp_crm_visita', 'erp_obra_planta', 'projetos_obras', 'projetos_modulo_config'],
       rpcs_chamadas = ARRAY['fn_proposta_excluir']
 WHERE rota = '/dashboard/projetos/propostas';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.propostas.editar', '/dashboard/projetos/propostas', 'Propostas', 'Abrir / editar proposta',
   'Abre a proposta no editor completo para mudar itens, preços, BDI, validade e condições.', 'Todo ajuste da proposta acontece no editor; a lista se atualiza ao voltar.', 'Trocar a validade', 'Querer editar proposta já aprovada: peça a liberação de edição no editor.', 'hub', 960, 1, 'publicado'),
  ('projetos.propostas.excluir', '/dashboard/projetos/propostas', 'Propostas', 'Excluir proposta',
   'Tira da lista uma proposta que não virou negócio, informando o motivo. Não apaga: guarda quem excluiu, quando e por quê.', 'Limpa propostas duplicadas ou lançadas por engano sem perder o histórico.', 'Proposta em duplicidade', 'Tentar excluir proposta aprovada ou com obra: não é permitido.', 'hub', 961, 1, 'publicado'),
  ('projetos.propostas.motivo_exclusao', '/dashboard/projetos/propostas', 'Propostas', 'Motivo da exclusão',
   'Por que a proposta está sendo excluída (mínimo 3 letras).', 'Fica na auditoria da proposta.', 'cliente desistiu antes do envio', 'Deixar em branco: a exclusão não é aceita.', 'hub', 962, 1, 'publicado'),
  ('projetos.propostas.acoes', '/dashboard/projetos/propostas', 'Propostas', 'Ações da proposta',
   'Abrir leva ao editor completo para editar; Excluir tira a proposta da lista (com motivo).', 'Mantém a lista limpa e rastreável.', 'Abrir / Excluir', 'Procurar as ações do lado direito da tabela no celular: role a tabela ou use a coluna fixa Ações.', 'hub', 963, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
