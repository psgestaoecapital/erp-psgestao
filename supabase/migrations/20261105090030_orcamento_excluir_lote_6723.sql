-- [#6723] Tryo: excluir orçamentos de vez e em lote (/dashboard/orcamentos).
-- ADITIVA: 1 função nova + linhas de ajuda "?" (RD-95). Nenhum dado é tocado na migration; só a ação do usuário apaga.
-- Regras: guarda de empresa; só apaga orçamento que NÃO virou negócio (sem pedido, obra, oportunidade, visita, planta,
-- histórico de cálculo, nem status aprovado/convertido); os vinculados ficam fora e voltam com o motivo.
-- Itens, despesas e histórico do orçamento caem em cascata (FK ON DELETE CASCADE). Quem apagou/quando/o quê: audit_log_global.
-- Devolve também os caminhos dos PDFs anexados para o cliente remover do bucket crm-anexos (sem deixar arquivo órfão).
CREATE OR REPLACE FUNCTION public.fn_orcamento_excluir_lote(p_ids uuid[], p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  o public.erp_orcamentos%ROWTYPE;
  v_id uuid;
  v_motivo text;
  v_apagados jsonb := '[]'::jsonb;
  v_ignorados jsonb := '[]'::jsonb;
  v_paths jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para excluir.'; END IF;
  IF p_ids IS NULL OR coalesce(array_length(p_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Nenhum orçamento selecionado.'; END IF;
  IF array_length(p_ids, 1) > 200 THEN RAISE EXCEPTION 'Selecione no máximo 200 orçamentos por vez.'; END IF;
  v_motivo := coalesce(nullif(btrim(p_motivo), ''), 'exclusão em lote pelo usuário');

  FOR v_id IN SELECT DISTINCT unnest(p_ids) LOOP
    SELECT * INTO o FROM public.erp_orcamentos WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', NULL, 'motivo', 'não encontrado');
      CONTINUE;
    END IF;
    PERFORM public.fn__guarda_empresa(o.company_id);

    IF o.status IN ('aprovado', 'convertido') OR o.pedido_id IS NOT NULL OR o.convertido_em IS NOT NULL THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', o.numero, 'motivo', 'já foi aprovado ou virou pedido');
    ELSIF o.obra_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.projetos_obras x WHERE x.orcamento_id = v_id) THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', o.numero, 'motivo', 'está ligado a uma obra');
    ELSIF EXISTS (SELECT 1 FROM public.erp_crm_oportunidade x WHERE x.orcamento_id = v_id) THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', o.numero, 'motivo', 'está ligado a uma oportunidade');
    ELSIF EXISTS (SELECT 1 FROM public.erp_crm_visita x WHERE x.gerou_orcamento_id = v_id) THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', o.numero, 'motivo', 'foi gerado por uma visita');
    ELSIF EXISTS (SELECT 1 FROM public.erp_obra_planta x WHERE x.orcamento_id = v_id)
       OR EXISTS (SELECT 1 FROM public.erp_calc_historico x WHERE x.orcamento_id = v_id) THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', o.numero, 'motivo', 'tem planta ou cálculo vinculado');
    ELSIF EXISTS (SELECT 1 FROM public.erp_orcamentos x WHERE x.orcamento_origem_id = v_id) THEN
      v_ignorados := v_ignorados || jsonb_build_object('id', v_id, 'numero', o.numero, 'motivo', 'tem versão derivada dele');
    ELSE
      INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
        VALUES (o.company_id, auth.uid(), 'erp_orcamentos', v_id::text, 'excluir_definitivo',
                jsonb_build_object('numero', o.numero, 'cliente_nome', o.cliente_nome, 'status', o.status, 'total', o.total,
                                   'data_emissao', o.data_emissao, 'pdf_anexo_path', o.pdf_anexo_path),
                jsonb_build_object('motivo', v_motivo));
      DELETE FROM public.erp_orcamentos WHERE id = v_id;
      v_apagados := v_apagados || jsonb_build_object('id', v_id, 'numero', o.numero);
      IF o.pdf_anexo_path IS NOT NULL THEN v_paths := v_paths || to_jsonb(o.pdf_anexo_path); END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'apagados', v_apagados, 'ignorados', v_ignorados, 'pdf_paths', v_paths);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_orcamento_excluir_lote(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_excluir_lote(uuid[], text) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('orcamentos.lista.selecionar', '/dashboard/orcamentos', 'Orçamentos', 'Selecionar orçamentos',
   'Marque a caixinha de cada orçamento que quer excluir, ou a caixinha do cabeçalho para marcar todos os que aparecem na lista.', 'Permite excluir vários orçamentos de uma vez, por exemplo para limpar a lista no início do mês.', 'Filtrar por "Recusado", marcar todos e excluir', 'Esquecer que a seleção vale só para o que está visível com o filtro atual.', 'hub', 970, 1, 'publicado'),
  ('orcamentos.lista.excluir_selecionados', '/dashboard/orcamentos', 'Orçamentos', 'Excluir selecionados',
   'Apaga de vez os orçamentos marcados, depois de você confirmar. Não dá para desfazer. Os que já viraram pedido, obra ou oportunidade ficam fora e a tela diz o motivo.', 'Limpa a lista de orçamentos que não serviram, sem mexer nos que já geraram negócio. Fica registrado quem excluiu e quando.', 'Marcar 12 orçamentos antigos e clicar Excluir selecionados', 'Achar que dá para recuperar depois: a exclusão é definitiva.', 'hub', 971, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
