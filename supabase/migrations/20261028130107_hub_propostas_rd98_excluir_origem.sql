-- Hub · /dashboard/projetos/propostas — delta 85→95 (aud8 27/10, caixa d30facfe · Code: dev7claudeps)
--   RD-98 p2/p4: CRUD por linha — Editar (abre o editor da proposta) e Excluir rastreável. erp_orcamentos é núcleo compartilhado
--     (comercial, pedidos, CRM): NÃO ganha coluna nova nem DELETE físico. "Excluir" = soft-delete pelo estado que o núcleo já
--     tem ('cancelado', mesmo caminho do fn_orcamento_cancelar), com quem/quando/motivo em erp_orcamento_historico + audit_log_global.
--     Recusa proposta aprovada/convertida/com obra ou pedido (o histórico financeiro não se apaga). A lista do Hub filtra 'cancelado'.
--   RD-98 p3: system_screens.views_consumidas/rpcs_chamadas da rota.
--   RD-95: "?" das colunas/ações novas.
-- Aditiva: função nova + linhas de ajuda + UPDATE de metadado da tela. Não altera função/tabela/view existente.

CREATE OR REPLACE FUNCTION public.fn_proposta_excluir(p_orcamento_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT id, company_id, numero, status, obra_id, pedido_id, total INTO o FROM public.erp_orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Proposta não encontrada'); END IF;
  IF o.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF o.status = 'cancelado' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Proposta já excluída'); END IF;
  IF o.status IN ('aprovado', 'convertido', 'venda_avulsa') OR o.obra_id IS NOT NULL OR o.pedido_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'proposta_com_movimento',
      'mensagem', 'Esta proposta já foi aprovada ou virou obra/pedido e não pode ser excluída. Reverta o pedido ou cancele a obra antes.');
  END IF;

  UPDATE public.erp_orcamentos SET status = 'cancelado', data_recusa = now(), updated_at = now() WHERE id = p_orcamento_id;

  INSERT INTO public.erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id, metadata)
  VALUES (p_orcamento_id, o.company_id, 'cancelado', COALESCE(NULLIF(btrim(p_motivo), ''), 'Excluída pelo Hub de Projetos'), auth.uid(),
          jsonb_build_object('origem', 'hub_propostas_excluir', 'status_anterior', o.status, 'motivo_texto', NULLIF(btrim(p_motivo), '')));
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (o.company_id, auth.uid(), 'erp_orcamentos', p_orcamento_id, 'excluir',
          jsonb_build_object('numero', o.numero, 'status', o.status, 'total', o.total),
          jsonb_build_object('status', 'cancelado', 'motivo', NULLIF(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_proposta_excluir(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_proposta_excluir(uuid, text) TO authenticated;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_orcamentos','erp_orcamentos_itens','erp_crm_oportunidade','erp_crm_visita','erp_obra_planta','projetos_obras','projetos_modulo_config']::text[],
       rpcs_chamadas = ARRAY['fn_proposta_excluir']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/propostas';

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.propostas.col_acoes', 'Colunas', 'Ações da proposta',
 'Editar abre a proposta no editor completo. Excluir tira a proposta da lista pedindo o motivo.',
 'Mantém a lista limpa: o que foi feito por engano some, mas a exclusão fica registrada (quem, quando e por quê). Proposta aprovada ou que virou obra/pedido não pode ser excluída.',
 'Excluir o rascunho duplicado da proposta 0042', 'Tentar excluir proposta já aprovada: o sistema recusa, reverta o pedido ou cancele a obra antes.',
 400, '/dashboard/projetos/propostas', 'projetos', 'publicado'),
('projetos.propostas.acao_editar', 'Ações', 'Editar proposta',
 'Abre a proposta no editor, onde você muda itens, preços, BDI, validade e condições.',
 'É o caminho para corrigir uma proposta antes de enviar ou de renegociar com o cliente.',
 'Ajustar o BDI de uma proposta abaixo do padrão', 'Editar depois do cliente aprovar: gere uma nova versão para não alterar o que foi acordado.',
 410, '/dashboard/projetos/propostas', 'projetos', 'publicado'),
('projetos.propostas.acao_excluir', 'Ações', 'Excluir proposta',
 'Pede o motivo e tira a proposta da lista. Fica gravado quem excluiu e quando.',
 'Serve para proposta criada por engano ou duplicada. Não apaga nada de verdade (exclusão rastreável) e some dos indicadores.',
 'Proposta duplicada', 'Excluir para "perder" um negócio: nesse caso recuse a proposta com o motivo da perda.',
 420, '/dashboard/projetos/propostas', 'projetos', 'publicado'),
('projetos.propostas.excluir_motivo', 'Ações', 'Motivo da exclusão',
 'Escreva em uma frase por que a proposta está sendo excluída.',
 'Fica no histórico da proposta e na auditoria, junto com seu nome e a data.',
 'Criada em duplicidade', 'Deixar em branco: depois ninguém lembra o motivo.',
 430, '/dashboard/projetos/propostas', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
