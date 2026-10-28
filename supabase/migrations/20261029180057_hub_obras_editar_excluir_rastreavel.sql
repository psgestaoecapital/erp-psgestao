-- Hub · Obras (/dashboard/projetos/obras) e Cockpit (/dashboard/projetos/cockpit) — fechamento até 95 (PDCA 28/10).
-- Pedido do auditor (RD-98 p2/p4): o card da obra só tinha Concluir/Pausar; faltava EDITAR a obra e EXCLUIR de forma rastreável.
-- 1) projetos_obras ganha deleted_at / deleted_by / deleted_motivo (soft-delete; nunca DELETE físico). Aditivo.
-- 2) fn_obra_editar(obra, jsonb): atualiza só campos da lista branca (nome, cliente, endereço, cidade/UF, responsável,
--    valor previsto, datas, observações). Grava audit_log_global. Escopo pela empresa do usuário (get_user_company_ids).
-- 3) fn_obra_excluir(obra, motivo): soft-delete com motivo obrigatório; RECUSA obra com medição, custo, escopo medido ou
--    NFS-e (obra com movimento só pode ser cancelada, não apagada). Grava audit_log_global.
-- 4) fn_obras_listar / fn_obras_kpis passam a ignorar obra excluída (corpo vigente preservado, só o filtro novo — RD-69).
-- 5) Textos de ajuda "?" (RD-95): editar/excluir + colunas do resultado do card.
-- 6) DEMO (Construtora …0006): responsável com nome real de equipe em vez de "Responsável Demo" (só a empresa DEMO).
-- Plano de volta: DROP FUNCTION fn_obra_editar/fn_obra_excluir; recriar fn_obras_listar/kpis sem o filtro; as colunas
-- novas são nulas e inofensivas.

ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_motivo text;

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

CREATE OR REPLACE FUNCTION public.fn_obra_editar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ant public.projetos_obras%ROWTYPE;
  v_nome text := NULLIF(btrim(p_dados->>'nome'), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT * INTO v_ant FROM public.projetos_obras
   WHERE id = p_obra_id AND deleted_at IS NULL AND company_id IN (SELECT get_user_company_ids());
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada_ou_sem_permissao'); END IF;
  IF p_dados ? 'nome' AND v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;
  IF p_dados ? 'valor_previsto' AND COALESCE((p_dados->>'valor_previsto')::numeric, 0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_previsto_negativo'); END IF;

  UPDATE public.projetos_obras SET
    nome              = COALESCE(v_nome, nome),
    cliente_nome      = CASE WHEN p_dados ? 'cliente_nome' THEN NULLIF(btrim(p_dados->>'cliente_nome'), '') ELSE cliente_nome END,
    endereco          = CASE WHEN p_dados ? 'endereco' THEN NULLIF(btrim(p_dados->>'endereco'), '') ELSE endereco END,
    cidade            = CASE WHEN p_dados ? 'cidade' THEN NULLIF(btrim(p_dados->>'cidade'), '') ELSE cidade END,
    uf                = CASE WHEN p_dados ? 'uf' THEN NULLIF(upper(btrim(p_dados->>'uf')), '') ELSE uf END,
    responsavel_nome  = CASE WHEN p_dados ? 'responsavel_nome' THEN NULLIF(btrim(p_dados->>'responsavel_nome'), '') ELSE responsavel_nome END,
    valor_previsto    = CASE WHEN p_dados ? 'valor_previsto' THEN COALESCE((p_dados->>'valor_previsto')::numeric, valor_previsto) ELSE valor_previsto END,
    data_inicio       = CASE WHEN p_dados ? 'data_inicio' THEN NULLIF(p_dados->>'data_inicio', '')::date ELSE data_inicio END,
    data_prevista_fim = CASE WHEN p_dados ? 'data_prevista_fim' THEN NULLIF(p_dados->>'data_prevista_fim', '')::date ELSE data_prevista_fim END,
    observacoes       = CASE WHEN p_dados ? 'observacoes' THEN NULLIF(btrim(p_dados->>'observacoes'), '') ELSE observacoes END,
    updated_at        = now()
   WHERE id = p_obra_id;

  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('projetos_obras', 'OBRA_EDITAR', p_obra_id::text,
          jsonb_build_object('company_id', v_ant.company_id, 'numero', v_ant.numero, 'antes',
            jsonb_build_object('nome', v_ant.nome, 'cliente_nome', v_ant.cliente_nome, 'responsavel_nome', v_ant.responsavel_nome,
                               'valor_previsto', v_ant.valor_previsto, 'data_inicio', v_ant.data_inicio, 'data_prevista_fim', v_ant.data_prevista_fim),
            'depois', p_dados),
          auth.uid(), now());
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o public.projetos_obras%ROWTYPE;
  v_mov int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF NULLIF(btrim(COALESCE(p_motivo, '')), '') IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  SELECT * INTO v_o FROM public.projetos_obras
   WHERE id = p_obra_id AND deleted_at IS NULL AND company_id IN (SELECT get_user_company_ids());
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada_ou_sem_permissao'); END IF;

  SELECT (SELECT count(*) FROM public.erp_nfse_emitidas n WHERE n.obra_id = p_obra_id)
       + (SELECT count(*) FROM public.erp_nfse_obra_medicao m WHERE m.obra_id = p_obra_id AND m.estornada_em IS NULL AND m.descartada_em IS NULL)
       + (SELECT count(*) FROM public.projetos_obra_item i WHERE i.obra_id = p_obra_id AND i.excluido_em IS NULL AND COALESCE(i.quantidade_medida, 0) > 0)
    INTO v_mov;
  IF v_mov > 0 OR COALESCE(v_o.valor_medido, 0) > 0 OR COALESCE(v_o.custo_realizado, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_com_movimento', 'detalhe', 'Obra com medição, nota fiscal ou custo não pode ser excluída — use Cancelar.');
  END IF;

  UPDATE public.projetos_obras
     SET deleted_at = now(), deleted_by = auth.uid(), deleted_motivo = btrim(p_motivo), updated_at = now()
   WHERE id = p_obra_id;
  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('projetos_obras', 'OBRA_EXCLUIR_SOFT', p_obra_id::text,
          jsonb_build_object('company_id', v_o.company_id, 'numero', v_o.numero, 'nome', v_o.nome, 'status', v_o.status, 'motivo', btrim(p_motivo)),
          auth.uid(), now());
  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_editar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_editar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_excluir(uuid, text) TO authenticated;

-- DEMO: responsável com nome de equipe (só a empresa DEMO Construtora Modelo)
UPDATE public.projetos_obras SET responsavel_nome = CASE WHEN numero IN ('DEMO-OB-002', 'DEMO-OB-004') THEN 'Marina Técnica (Demo)' ELSE 'Carlos Encarregado (Demo)' END
 WHERE company_id = 'b0700000-0000-4000-a000-000000000006' AND responsavel_nome = 'Responsável Demo';

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.obras.card_editar', 'Ações', 'Editar obra',
  'Abre o formulário com nome, cliente, endereço, responsável, valor previsto, datas e observações da obra.',
  'Corrige os dados da obra sem recriá-la; o histórico da alteração fica registrado (quem mudou e o que mudou).',
  'Trocar o responsável de "Carlos" para "Marina" e ajustar a data prevista de término.',
  'Tentar mudar o número da obra ou o status por aqui: o status muda pelos botões Concluir/Pausar/Cancelar.'),
 ('projetos.obras.card_excluir', 'Ações', 'Excluir obra',
  'Informe o motivo da exclusão (obrigatório). A obra sai das listas, mas fica guardada com quem excluiu, quando e por quê.',
  'Remove obra criada por engano sem perder o rastro. Obra com medição, nota fiscal ou custo não pode ser excluída — nesse caso use Cancelar.',
  'Obra duplicada criada por engano → Excluir, motivo "duplicada da OBR-0003".',
  'Excluir para "encerrar" uma obra real: use Concluir ou Cancelar, que mantêm o resultado nos relatórios.'),
 ('projetos.obras.res_faturado', 'Resultado da obra', 'Faturado',
  'Não se preenche: soma as NFS-e autorizadas ligadas a esta obra.',
  'Mostra quanto já foi cobrado do cliente por esta obra.',
  'Duas notas autorizadas de R$ 10.000 → Faturado R$ 20.000.',
  'Esperar valor aqui antes de a primeira NFS-e ser autorizada.'),
 ('projetos.obras.res_recebido', 'Resultado da obra', 'Recebido',
  'Não se preenche: soma as baixas dos títulos das notas desta obra.',
  'Mostra quanto do faturado já entrou no caixa.',
  'Faturado R$ 20.000 e uma baixa de R$ 8.000 → Recebido R$ 8.000.',
  'Estranhar Recebido zero com nota emitida: o título ainda não teve baixa ou a nota está sem título no financeiro.'),
 ('projetos.obras.res_a_receber', 'Resultado da obra', 'A receber',
  'Não se preenche: é o saldo em aberto dos títulos das notas desta obra.',
  'Mostra o que ainda falta o cliente pagar.',
  'Título de R$ 12.000 com R$ 8.000 baixados → A receber R$ 4.000.',
  'Somar A receber com Recebido esperando fechar o Faturado quando há nota sem título.'),
 ('projetos.obras.res_custo', 'Resultado da obra', 'Custo',
  'Não se preenche: soma o custo de material e de viagens lançado nesta obra.',
  'Compara o que a obra já gastou com o que já faturou, para enxergar a margem.',
  'Material R$ 3.000 + viagens R$ 1.200 → Custo R$ 4.200.',
  'Ler "—" como R$ 0: significa que o custo não pôde ser carregado agora.'),
 ('projetos.obras.editar_nome', 'Editar obra', 'Nome da obra',
  'Nome pelo qual a equipe reconhece a obra.',
  'Aparece em listas, cockpit, OS e relatórios.',
  'Residencial Bela Vista — Bloco B',
  'Colocar só o nome do cliente: dificulta achar a obra quando há várias do mesmo cliente.'),
 ('projetos.obras.editar_cliente', 'Editar obra', 'Cliente',
  'Nome do cliente dono da obra.',
  'Agrupa e filtra as obras por cliente.',
  'Construtora Modelo Ltda',
  'Escrever o mesmo cliente de formas diferentes e dividir o filtro.'),
 ('projetos.obras.editar_cidade', 'Editar obra', 'Cidade',
  'Cidade onde a obra é executada.',
  'Aparece no cartão e ajuda a planejar viagens e equipe.',
  'Chapecó',
  'Colocar a cidade da sede do cliente em vez da cidade da obra.'),
 ('projetos.obras.editar_uf', 'Editar obra', 'UF',
  'Sigla do estado, duas letras.',
  'Complementa a cidade; o cadastro fiscal usa o CEP em Dados fiscais.',
  'SC',
  'Escrever o nome do estado por extenso.'),
 ('projetos.obras.editar_responsavel', 'Editar obra', 'Responsável',
  'Nome de quem responde pela obra no canteiro.',
  'Aparece no cartão e filtra as OS por responsável.',
  'Carlos Encarregado',
  'Deixar em branco: o cartão mostra "sem responsável".'),
 ('projetos.obras.editar_valor', 'Editar obra', 'Valor previsto',
  'Valor total previsto do contrato, em reais.',
  'Base do avanço financeiro (medido ÷ previsto) e do KPI Valor em andamento.',
  '250000',
  'Digitar com R$ ou pontos de milhar errados; use só números e vírgula dos centavos.'),
 ('projetos.obras.editar_inicio', 'Editar obra', 'Início',
  'Data em que a obra começou ou vai começar.',
  'Ordena a lista e alimenta o cronograma.',
  '01/11/2026',
  'Colocar a data do contrato em vez da data real de início.'),
 ('projetos.obras.editar_fim', 'Editar obra', 'Término previsto',
  'Data prevista para entregar a obra.',
  'Define o alerta de prazo vencido no cockpit.',
  '30/03/2027',
  'Esquecer de atualizar após replanejar: a obra aparece como prazo vencido.'),
 ('projetos.obras.editar_observacoes', 'Editar obra', 'Observação',
  'Texto livre que será registrado na obra.',
  'Guarda combinados e contexto para quem assume a obra depois.',
  'Cliente pediu trocar o piso do bloco B.',
  'Registrar dado fiscal aqui: use Dados fiscais.'),
 ('projetos.obras.excluir_motivo', 'Editar obra', 'Motivo da exclusão',
  'Explique em uma frase por que a obra está sendo excluída.',
  'Fica gravado junto com quem excluiu e quando, para auditoria.',
  'Duplicada da OBR-0003, criada por engano.',
  'Escrever "teste": o motivo precisa explicar para quem auditar depois.')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
