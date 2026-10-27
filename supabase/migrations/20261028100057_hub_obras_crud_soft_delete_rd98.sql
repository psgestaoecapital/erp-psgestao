-- Hub · /dashboard/projetos/obras — delta até 95 (auditoria Hub 27/10 · Code: dev7claudeps)
--   #2 RD-98 p2: CRUD completo da obra — faltava EDITAR e EXCLUIR. Editar = RPC guardada (todos os campos de cadastro,
--      não mexe em status/valores calculados); Excluir = soft-delete rastreável (deleted_at/deleted_by + audit_log_global),
--      nunca DELETE físico; restaurar reversível. A listagem e os KPIs passam a filtrar deleted_at.
--   #4 RD-98 p3: system_screens.views_consumidas/rpcs_chamadas da rota.
--   #3 RD-95: "?" das ações novas.
-- SENSÍVEL (RD-94.1): CREATE OR REPLACE de fn_obras_listar/fn_obras_kpis (mesma assinatura, só acrescenta o filtro
--   deleted_at IS NULL). Colunas aditivas em projetos_obras; nenhuma mudança de RLS/policy.

ALTER TABLE public.projetos_obras
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

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

-- Dados completos da obra para o formulário de edição.
CREATE OR REPLACE FUNCTION public.fn_obra_obter(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND OR o.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'obra', jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'nome', o.nome, 'cliente_nome', o.cliente_nome, 'endereco', o.endereco,
    'numero_endereco', o.numero_endereco, 'bairro', o.bairro, 'cidade', o.cidade, 'uf', o.uf, 'cep', o.cep,
    'responsavel_nome', o.responsavel_nome, 'valor_previsto', o.valor_previsto, 'pct_conclusao', o.pct_conclusao,
    'data_inicio', o.data_inicio, 'data_prevista_fim', o.data_prevista_fim, 'observacoes', o.observacoes));
END $function$;

-- Editar a obra (cadastro). Não altera status, valor medido nem custo realizado (esses vêm de medição/fluxo).
CREATE OR REPLACE FUNCTION public.fn_obra_editar(
  p_obra_id uuid, p_nome text, p_cliente_nome text DEFAULT NULL, p_endereco text DEFAULT NULL,
  p_numero_endereco text DEFAULT NULL, p_bairro text DEFAULT NULL, p_cidade text DEFAULT NULL, p_uf text DEFAULT NULL,
  p_cep text DEFAULT NULL, p_responsavel_nome text DEFAULT NULL, p_valor_previsto numeric DEFAULT NULL,
  p_pct_conclusao integer DEFAULT NULL, p_data_inicio date DEFAULT NULL, p_data_prevista_fim date DEFAULT NULL,
  p_observacoes text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE; v_ant jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF coalesce(btrim(p_nome), '') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome da obra'); END IF;
  IF p_valor_previsto IS NOT NULL AND p_valor_previsto < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Valor previsto não pode ser negativo'); END IF;
  IF p_pct_conclusao IS NOT NULL AND (p_pct_conclusao < 0 OR p_pct_conclusao > 100) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Conclusão deve estar entre 0 e 100'); END IF;
  IF p_data_inicio IS NOT NULL AND p_data_prevista_fim IS NOT NULL AND p_data_prevista_fim < p_data_inicio THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'A data prevista de fim não pode ser antes do início');
  END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND OR o.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada');
  END IF;
  v_ant := jsonb_build_object('nome', o.nome, 'cliente_nome', o.cliente_nome, 'cidade', o.cidade, 'uf', o.uf,
    'responsavel_nome', o.responsavel_nome, 'valor_previsto', o.valor_previsto, 'pct_conclusao', o.pct_conclusao,
    'data_inicio', o.data_inicio, 'data_prevista_fim', o.data_prevista_fim);
  UPDATE public.projetos_obras SET
      nome = btrim(p_nome), cliente_nome = nullif(btrim(p_cliente_nome), ''), endereco = nullif(btrim(p_endereco), ''),
      numero_endereco = nullif(btrim(p_numero_endereco), ''), bairro = nullif(btrim(p_bairro), ''),
      cidade = nullif(btrim(p_cidade), ''), uf = nullif(upper(btrim(p_uf)), ''), cep = nullif(btrim(p_cep), ''),
      responsavel_nome = nullif(btrim(p_responsavel_nome), ''),
      valor_previsto = coalesce(p_valor_previsto, valor_previsto), pct_conclusao = coalesce(p_pct_conclusao, pct_conclusao),
      data_inicio = p_data_inicio, data_prevista_fim = p_data_prevista_fim,
      observacoes = nullif(btrim(p_observacoes), ''), updated_at = now()
    WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'editar', v_ant,
      jsonb_build_object('nome', btrim(p_nome), 'cliente_nome', p_cliente_nome, 'cidade', p_cidade, 'uf', p_uf,
        'responsavel_nome', p_responsavel_nome, 'valor_previsto', p_valor_previsto, 'pct_conclusao', p_pct_conclusao,
        'data_inicio', p_data_inicio, 'data_prevista_fim', p_data_prevista_fim));
  RETURN jsonb_build_object('ok', true, 'numero', o.numero);
END $function$;

-- Excluir (soft-delete rastreável). Obra com escopo medido não se exclui: cancele em vez de excluir.
CREATE OR REPLACE FUNCTION public.fn_obra_excluir(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND OR o.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada');
  END IF;
  IF o.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra já excluída'); END IF;
  IF coalesce(o.valor_medido, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Obra com medição lançada não pode ser excluída — use Cancelar.');
  END IF;
  UPDATE public.projetos_obras SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now() WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'excluir',
      jsonb_build_object('numero', o.numero, 'nome', o.nome, 'status', o.status, 'deleted_at', NULL),
      jsonb_build_object('deleted_at', now()));
  RETURN jsonb_build_object('ok', true, 'numero', o.numero, 'nome', o.nome);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_obra_restaurar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.projetos_obras%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT * INTO o FROM public.projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND OR o.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada');
  END IF;
  IF o.deleted_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não está excluída'); END IF;
  UPDATE public.projetos_obras SET deleted_at = NULL, deleted_by = NULL, updated_at = now() WHERE id = p_obra_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'restaurar',
      jsonb_build_object('deleted_at', o.deleted_at), jsonb_build_object('deleted_at', NULL));
  RETURN jsonb_build_object('ok', true, 'numero', o.numero);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_obter(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_editar(uuid, text, text, text, text, text, text, text, text, text, numeric, integer, date, date, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_excluir(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_restaurar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obra_obter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_editar(uuid, text, text, text, text, text, text, text, text, text, numeric, integer, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_excluir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_obra_restaurar(uuid) TO authenticated;

-- RD-98 p3 · origem do dado da tela
UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_obras', 'v_obra_resultado']::text[],
       rpcs_chamadas = ARRAY['fn_obras_kpis', 'fn_obras_listar', 'fn_obras_receita', 'fn_obra_mudar_status',
         'fn_obra_obter', 'fn_obra_editar', 'fn_obra_excluir', 'fn_obra_restaurar', 'fn_obra_escopo']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras';

-- RD-95: "?" das ações novas
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.obras.editar', '/dashboard/projetos/obras', 'Obras', 'Editar obra',
   'Abre o cadastro da obra para corrigir nome, cliente, endereço, responsável, valor previsto, andamento e datas.',
   'Mantém o cadastro certo sem recriar a obra. Cada alteração fica registrada (quem e quando).',
   'Trocou o responsável? Clique em Editar, mude o campo e Salve.',
   'Tentar mudar a situação por aqui — Concluir, Pausar e Cancelar ficam nos botões do cartão.',
   'hub_projetos', 60),
  ('projetos.obras.excluir', '/dashboard/projetos/obras', 'Obras', 'Excluir obra',
   'Remove a obra da lista. Não apaga de verdade: fica guardada com quem excluiu e quando, e pode ser restaurada.',
   'Tira da tela uma obra criada por engano sem perder o histórico.',
   'Obra duplicada? Clique em Excluir e confirme.',
   'Excluir obra que já tem medição: o sistema recusa — use Cancelar.',
   'hub_projetos', 61),
  ('projetos.obras.restaurar', '/dashboard/projetos/obras', 'Obras', 'Restaurar obra',
   'Aparece logo após excluir uma obra: clique em Desfazer para trazê-la de volta, com a mesma situação que tinha.',
   'Desfaz uma exclusão feita por engano.',
   'Excluiu a obra errada? Clique em Desfazer no aviso verde, no topo da lista.',
   'Esperar para desfazer depois de sair da tela — o botão só fica disponível nesta visita; depois peça a restauração ao suporte.',
   'hub_projetos', 62),
  ('projetos.obras.edit_nome', '/dashboard/projetos/obras', 'Obras', 'Nome da obra',
   'O nome pelo qual a obra é conhecida.',
   'Identifica a obra em listas, notas e relatórios.',
   'Reforma Loja Centro',
   'Deixar em branco: o sistema exige um nome.',
   'hub_projetos', 63),
  ('projetos.obras.edit_cliente', '/dashboard/projetos/obras', 'Obras', 'Cliente',
   'Nome do cliente dono da obra.',
   'Aparece no cartão e na NFS-e.',
   'Clínica Bem Viver',
   'Usar abreviação diferente da usada no cadastro de clientes.',
   'hub_projetos', 64),
  ('projetos.obras.edit_responsavel', '/dashboard/projetos/obras', 'Obras', 'Responsável',
   'Quem toca a obra no dia a dia.',
   'Mostra de quem é a obra e facilita cobrar andamento.',
   'Marcos Lima',
   'Deixar sem responsável: ninguém é cobrado.',
   'hub_projetos', 65),
  ('projetos.obras.edit_valor', '/dashboard/projetos/obras', 'Obras', 'Valor previsto (R$)',
   'O valor total contratado da obra.',
   'Base do resultado: compara o previsto com faturado e custo.',
   '150000',
   'Colocar o valor sem BDI ou com centavos errados.',
   'hub_projetos', 66),
  ('projetos.obras.edit_pct', '/dashboard/projetos/obras', 'Obras', 'Conclusão (%)',
   'De 0 a 100, quanto da obra já foi feito.',
   'Move a barra de andamento do cartão.',
   '35',
   'Passar de 100 ou usar vírgula; ao concluir a obra o sistema põe 100.',
   'hub_projetos', 67),
  ('projetos.obras.edit_inicio', '/dashboard/projetos/obras', 'Obras', 'Início',
   'Data em que a obra começou.',
   'Alimenta cronograma e linha do tempo.',
   '03/11/2026',
   'Início depois da previsão de fim.',
   'hub_projetos', 68),
  ('projetos.obras.edit_fim', '/dashboard/projetos/obras', 'Obras', 'Previsão de fim',
   'Data prevista para entregar a obra.',
   'Base para avisar atraso.',
   '15/12/2026',
   'Data anterior ao início — o sistema recusa.',
   'hub_projetos', 69),
  ('projetos.obras.edit_endereco', '/dashboard/projetos/obras', 'Obras', 'Endereço',
   'Rua ou avenida da obra.',
   'Usado na NFS-e de construção e nas visitas.',
   'Av. Brasil',
   'Misturar o número da obra aqui; use o campo Número.',
   'hub_projetos', 70),
  ('projetos.obras.edit_numero', '/dashboard/projetos/obras', 'Obras', 'Número',
   'Número do imóvel da obra.',
   'Completa o endereço da NFS-e.',
   '1200',
   'Escrever "s/n" quando o número existe.',
   'hub_projetos', 71),
  ('projetos.obras.edit_bairro', '/dashboard/projetos/obras', 'Obras', 'Bairro',
   'Bairro da obra.',
   'Completa o endereço da obra.',
   'Centro',
   'Colocar a cidade no lugar do bairro.',
   'hub_projetos', 72),
  ('projetos.obras.edit_cidade', '/dashboard/projetos/obras', 'Obras', 'Cidade',
   'Cidade onde a obra acontece.',
   'Define o município da NFS-e.',
   'Campo Grande',
   'Cidade do cliente em vez da cidade da obra.',
   'hub_projetos', 73),
  ('projetos.obras.edit_uf', '/dashboard/projetos/obras', 'Obras', 'UF',
   'Estado, com duas letras.',
   'Completa o endereço e o município fiscal.',
   'MS',
   'Escrever o nome do estado por extenso.',
   'hub_projetos', 74),
  ('projetos.obras.edit_cep', '/dashboard/projetos/obras', 'Obras', 'CEP',
   'CEP da obra (8 números).',
   'Ajuda a localizar o endereço e o município.',
   '79002-000',
   'Usar o CEP do escritório do cliente.',
   'hub_projetos', 75),
  ('projetos.obras.edit_obs', '/dashboard/projetos/obras', 'Obras', 'Observações',
   'Anotações livres sobre a obra.',
   'Guarda combinados e cuidados que não cabem nos outros campos.',
   'Acesso só após as 8h.',
   'Colocar aqui dados que têm campo próprio.',
   'hub_projetos', 76)
ON CONFLICT (chave) DO UPDATE
  SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
      para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo,
      erro_comum = EXCLUDED.erro_comum, atualizado_em = now();
