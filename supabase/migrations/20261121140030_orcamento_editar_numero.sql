-- Hub Projetos / Propostas: editar o NÚMERO do orçamento (auto-gerado no nascimento, editável depois).
-- Valida empresa (get_user_company_ids) + unicidade (company_id, numero) e grava rastro em erp_orcamento_historico.
-- A auto-geração (trg_orcamento_set_numero via next_orcamento_numero) continua no INSERT; isto é a edição opcional.
-- Orçamento NÃO é documento fiscal (não é NF-e): número editável é OK; a única regra é a unicidade por empresa.
-- Aditiva; nenhum schema/RLS/dado existente muda além do próprio número editado (com rastro).

CREATE OR REPLACE FUNCTION public.fn_orcamento_editar_numero(p_orcamento_id uuid, p_numero text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_old text; v_company uuid; v_nome text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  p_numero := btrim(coalesce(p_numero,''));
  IF p_numero = '' THEN RETURN jsonb_build_object('ok',false,'erro','numero_vazio'); END IF;
  IF length(p_numero) > 40 THEN RETURN jsonb_build_object('ok',false,'erro','numero_longo'); END IF;
  SELECT company_id, numero INTO v_company, v_old FROM erp_orcamentos WHERE id = p_orcamento_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','orcamento_nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT public.get_user_company_ids()) THEN
     RETURN jsonb_build_object('ok',false,'erro','sem_acesso_empresa'); END IF;
  IF p_numero = coalesce(v_old,'') THEN RETURN jsonb_build_object('ok',true,'numero',v_old,'inalterado',true); END IF;
  IF EXISTS (SELECT 1 FROM erp_orcamentos WHERE company_id = v_company AND numero = p_numero AND id <> p_orcamento_id) THEN
     RETURN jsonb_build_object('ok',false,'erro','numero_em_uso','numero',p_numero); END IF;
  UPDATE erp_orcamentos SET numero = p_numero, updated_at = now() WHERE id = p_orcamento_id;
  SELECT coalesce(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id = v_uid;
  INSERT INTO erp_orcamento_historico(orcamento_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata, created_at)
  VALUES (p_orcamento_id, v_company, 'numero_editado',
          'Número: '||coalesce(v_old,'—')||' -> '||p_numero, v_uid, v_nome,
          jsonb_build_object('de', v_old, 'para', p_numero), now());
  RETURN jsonb_build_object('ok',true,'numero',p_numero,'de',v_old);
END $function$;
REVOKE ALL ON FUNCTION public.fn_orcamento_editar_numero(uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_editar_numero(uuid,text) TO authenticated;

-- RD-95: "?" dos campos NOVOS da tela de Propostas (filtro por número, ordenação, editar número).
-- Tabela global de referência (sem company_id), chave única; re-rodar só atualiza o texto.
INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'projetos.propostas.filtro_numero',
    '/dashboard/projetos/propostas',
    'Filtrar por número',
    'Digite parte do número do orçamento (ex.: 0039 ou ORC-2026). A lista busca no banco inteiro, não só nas propostas já carregadas na tela.',
    'Serve para achar um orçamento antigo que não está entre os 100 mais recentes exibidos — a busca comum olha só o que está na tela; este campo consulta o servidor.',
    'Digitar "0007" encontra o ORC-2026-0007 mesmo que ele seja de meses atrás.',
    'Esperar achar por cliente aqui: este campo é só por número. Para cliente ou orçamentista, use a busca ao lado.',
    'projetos',
    40
  ),
  (
    'projetos.propostas.ordenar',
    '/dashboard/projetos/propostas',
    'Ordenar por',
    'Escolha a ordem da lista: mais recentes (padrão), mais antigas, por número ou por valor.',
    'Ajuda a encontrar e comparar propostas do jeito que você precisa — por exemplo, as de maior valor primeiro.',
    'Escolher "Maior valor" traz as propostas mais caras no topo.',
    'A ordenação vale sobre as propostas já carregadas; para alcançar uma antiga específica, filtre antes pelo número.',
    'projetos',
    41
  ),
  (
    'projetos.propostas.editar_numero',
    '/dashboard/projetos/propostas',
    'Editar o número',
    'O número nasce automático quando a proposta é criada. Aqui você pode trocá-lo depois — tem de ser único dentro da empresa.',
    'Permite acertar ou padronizar o número do orçamento sem recriar a proposta. Toda troca fica registrada (quem, quando, de qual número para qual).',
    'Trocar ORC-2026-0039 por 2026-OBRA-12 para seguir a numeração interna da empresa.',
    'Repetir um número que já existe na empresa: o sistema recusa e avisa; cada número é único por empresa.',
    'projetos',
    42
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = 'publicado',
  atualizado_em = now();
