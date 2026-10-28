-- Hub · Obras (/dashboard/projetos/obras): CRUD completo do card (RD-98) + "?" (RD-95) nas 4 colunas do resultado.
-- Plano do auditor (nota 90): (1) "?" nas colunas Faturado/Recebido/A receber/Custo; (2) Editar a obra;
-- (3) Excluir RASTREÁVEL: soft-delete (deleted_at/deleted_by/deleted_motivo) + audit_log_global, nunca DELETE físico.
-- Aditiva: 3 colunas novas nullable; fn_obras_listar/fn_obras_kpis mantêm a assinatura e só passam a ocultar obra excluída;
-- 2 RPCs novas com guarda por empresa do usuário (get_user_company_ids) e REVOKE anon; textos de ajuda ON CONFLICT DO NOTHING.
ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_motivo text;
CREATE INDEX IF NOT EXISTS idx_projetos_obras_ativas ON public.projetos_obras (company_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_obras_listar(p_company_ids uuid[], p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, numero text, nome text, cliente_nome text, status text, valor_previsto numeric, pct_conclusao integer, cidade text, uf text, responsavel_nome text, data_inicio date, data_prevista_fim date, data_conclusao date)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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

-- Editar os dados cadastrais da obra (não mexe em status, medição nem custo).
CREATE OR REPLACE FUNCTION public.fn_obra_editar(
  p_obra_id uuid, p_nome text, p_cliente_nome text, p_cidade text, p_uf text, p_responsavel_nome text,
  p_valor_previsto numeric, p_data_inicio date, p_data_prevista_fim date, p_observacoes text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ant public.projetos_obras%ROWTYPE; v_novo public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Faça login para editar a obra.'); END IF;
  IF btrim(coalesce(p_nome,'')) = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome da obra.'); END IF;
  IF coalesce(p_valor_previsto,0) < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'O valor previsto não pode ser negativo.'); END IF;
  IF p_data_inicio IS NOT NULL AND p_data_prevista_fim IS NOT NULL AND p_data_prevista_fim < p_data_inicio THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O prazo final não pode ser antes do início.'); END IF;
  SELECT * INTO v_ant FROM public.projetos_obras
   WHERE id = p_obra_id AND deleted_at IS NULL AND company_id IN (SELECT get_user_company_ids());
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada ou sem permissão.'); END IF;
  UPDATE public.projetos_obras SET
      nome = btrim(p_nome), cliente_nome = NULLIF(btrim(coalesce(p_cliente_nome,'')), ''),
      cidade = NULLIF(btrim(coalesce(p_cidade,'')), ''), uf = NULLIF(upper(btrim(coalesce(p_uf,''))), ''),
      responsavel_nome = NULLIF(btrim(coalesce(p_responsavel_nome,'')), ''),
      valor_previsto = coalesce(p_valor_previsto, valor_previsto),
      data_inicio = p_data_inicio, data_prevista_fim = p_data_prevista_fim,
      observacoes = NULLIF(btrim(coalesce(p_observacoes,'')), ''), updated_at = now()
   WHERE id = p_obra_id RETURNING * INTO v_novo;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_ant.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_editar', to_jsonb(v_ant), to_jsonb(v_novo));
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END $function$;

-- Excluir RASTREÁVEL (soft-delete). Recusa obra já medida/concluída: ali o certo é cancelar, para não esconder faturamento.
CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_o public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Faça login para excluir a obra.'); END IF;
  IF length(btrim(coalesce(p_motivo,''))) < 5 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão (mínimo 5 letras).'); END IF;
  SELECT * INTO v_o FROM public.projetos_obras
   WHERE id = p_obra_id AND deleted_at IS NULL AND company_id IN (SELECT get_user_company_ids());
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada ou sem permissão.'); END IF;
  IF v_o.status = 'concluida' OR coalesce(v_o.valor_medido,0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Obra com medição ou concluída não pode ser excluída — use Cancelar.'); END IF;
  UPDATE public.projetos_obras SET deleted_at = now(), deleted_by = auth.uid(), deleted_motivo = btrim(p_motivo), updated_at = now()
   WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_o.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_excluir', to_jsonb(v_o),
          jsonb_build_object('deleted_motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_editar(uuid,text,text,text,text,text,numeric,date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_excluir(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_editar(uuid,text,text,text,text,text,numeric,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_excluir(uuid,text) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.obras.resultado_faturado', 'Resultado da obra', 'Faturado',
  'Não se preenche: soma das NFS-e autorizadas ligadas a esta obra.',
  'Mostra quanto já foi cobrado do cliente por esta obra. Base para saber o que falta receber.',
  'Duas notas autorizadas de R$ 10.000 e R$ 5.000 → Faturado R$ 15.000.',
  'Estranhar R$ 0: a nota ainda não foi emitida/autorizada ou não aponta para esta obra.', 41),
 ('projetos.obras.resultado_recebido', 'Resultado da obra', 'Recebido',
  'Não se preenche: soma das baixas dos títulos das NFS-e desta obra.',
  'Mostra o dinheiro que já entrou. Faturado menos Recebido é o que ainda está com o cliente.',
  'Nota de R$ 15.000 com baixa de R$ 10.000 → Recebido R$ 10.000.',
  'Nota sem título no financeiro não entra aqui: gere o título para a baixa contar.', 42),
 ('projetos.obras.resultado_a_receber', 'Resultado da obra', 'A receber',
  'Não se preenche: Faturado menos Recebido.',
  'Mostra o saldo que o cliente ainda deve desta obra — base para a cobrança.',
  'Faturado R$ 15.000 − Recebido R$ 10.000 → A receber R$ 5.000.',
  'Confundir com valor a faturar: aqui só entra o que já foi cobrado em nota.', 43),
 ('projetos.obras.resultado_custo', 'Resultado da obra', 'Custo',
  'Não se preenche: soma do custo de material e das viagens lançados na obra.',
  'Compara com o faturado para enxergar a margem. "—" significa que nenhum custo foi lançado ainda (não é custo zero).',
  'Material R$ 8.000 + viagens R$ 1.200 → Custo R$ 9.200.',
  'Achar que a obra não tem custo: lance material, viagens e horas para o custo aparecer.', 44),
 ('projetos.obras.editar_obra', 'Ações', 'Editar obra',
  'Toque para corrigir nome, cliente, cidade/UF, responsável, valor previsto, prazos e observações.',
  'Mantém o cadastro da obra certo; o valor previsto alimenta os totais do topo e os prazos alimentam os alertas do cockpit.',
  'Trocar o responsável de "Sem responsável" para "Marcos Lima" e ajustar o prazo final.',
  'Mudar o status por aqui: concluir, pausar e cancelar ficam nos botões do card.', 45),
 ('projetos.obras.excluir_obra', 'Ações', 'Excluir obra',
  'Toque, escreva o motivo (mínimo 5 letras) e confirme.',
  'Tira a obra criada por engano da lista e dos totais. Não apaga nada: fica registrado quem excluiu, quando e por quê.',
  'Obra duplicada por engano → Excluir, motivo "duplicada da OBR-2026-0004".',
  'Tentar excluir obra com medição ou concluída: nesses casos use Cancelar, para não esconder faturamento.', 46),
 ('projetos.obras.editar_nome', 'Editar obra', 'Nome da obra',
  'Nome que identifica a obra na lista, no cockpit e nos documentos.',
  'Aparece em toda a tela e nos relatórios; não altera valores.',
  'Reforma loja – Mercado Central',
  'Deixar em branco: o nome é obrigatório.', 50),
 ('projetos.obras.editar_cliente', 'Editar obra', 'Cliente',
  'Nome do cliente dono da obra.',
  'Agrupa a obra por cliente na busca e no cockpit.',
  'Mercado Central Ltda',
  'Escrever o mesmo cliente de dois jeitos e perder o filtro.', 51),
 ('projetos.obras.editar_cidade', 'Editar obra', 'Cidade',
  'Cidade onde a obra é executada.',
  'Ajuda a localizar a obra; o endereço fiscal completo fica em "Dados fiscais".',
  'Chapecó',
  'Confundir com a cidade do cliente.', 52),
 ('projetos.obras.editar_uf', 'Editar obra', 'UF',
  'Sigla do estado, 2 letras.',
  'Completa o local da obra.',
  'SC',
  'Escrever o nome do estado por extenso.', 53),
 ('projetos.obras.editar_responsavel', 'Editar obra', 'Responsável',
  'Nome de quem responde pela obra.',
  'Aparece no card e permite filtrar as obras por responsável.',
  'Marcos Lima',
  'Deixar vazio: o card mostra "sem responsável".', 54),
 ('projetos.obras.editar_valor', 'Editar obra', 'Valor previsto (R$)',
  'Valor total contratado ou orçado da obra, em reais.',
  'Entra nos totais "Valor em andamento" e "Valor concluído" do topo.',
  '150.000,00',
  'Digitar com ponto no lugar da vírgula decimal.', 55),
 ('projetos.obras.editar_inicio', 'Editar obra', 'Início',
  'Data em que a obra começa ou começou.',
  'Ordena a lista e serve de base para o cronograma.',
  '01/11/2026',
  'Colocar data posterior ao prazo final.', 56),
 ('projetos.obras.editar_prazo', 'Editar obra', 'Prazo final',
  'Data prevista para entregar a obra.',
  'Gera o alerta de prazo vencido no cockpit.',
  '30/01/2027',
  'Esquecer de atualizar quando o prazo muda.', 57),
 ('projetos.obras.editar_observacoes', 'Editar obra', 'Observações',
  'Anotações livres sobre a obra.',
  'Só registro interno; não entra em cálculo.',
  'Cliente pediu acesso só após as 8h.',
  'Guardar aqui dado que tem campo próprio.', 58),
 ('projetos.obras.excluir_motivo', 'Editar obra', 'Motivo da exclusão',
  'Explique em poucas palavras por que a obra sai da lista (mínimo 5 letras).',
  'Fica gravado no histórico com quem excluiu e quando.',
  'duplicada da OBR-2026-0004',
  'Motivo genérico demais, que não ajuda a auditoria depois.', 59)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
