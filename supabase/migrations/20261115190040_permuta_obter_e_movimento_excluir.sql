-- Permutas (Hub › Financeiro) — fecha os gaps de CRUD (RD-98 pilar 2) da tela /dashboard/hub/permutas.
-- PDCA Hub aud8: (1) não havia EDITAR permuta na UI; (2) não havia EXCLUIR permuta na UI (RPC já existia);
-- (3) não havia EXCLUIR MOVIMENTO (faltava a RPC). Estas 2 funções novas destravam o editar e o excluir-movimento.
-- Aditivas: não alteram schema nem dado de cliente; apenas adicionam funções (SECURITY DEFINER + fn__guarda_empresa,
-- o mesmo guarda fail-closed de fn_permuta_excluir). Soft-delete usa colunas já existentes (deleted_at/by/motivo).

-- fn_permuta_obter: devolve os campos EDITÁVEIS CRUS de uma permuta, para pré-preencher o formulário de edição.
-- (fn_permuta_extrato traz o cabeçalho calculado, mas não pct_permuta/valor_dinheiro/intragrupo/contrato_anexo/company_id.)
CREATE OR REPLACE FUNCTION public.fn_permuta_obter(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_out jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.hub_permuta WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'permuta_nao_encontrada'); END IF;
  IF NOT (public.is_admin() OR v_company IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_empresa'); END IF;
  SELECT jsonb_build_object('ok', true, 'permuta', jsonb_build_object(
      'id', id, 'company_id', company_id, 'obra_id', obra_id, 'contratante', contratante,
      'ativo_descr', ativo_descr, 'tipo_contrato', tipo_contrato, 'pct_permuta', pct_permuta,
      'valor_permuta', valor_permuta, 'valor_dinheiro', valor_dinheiro, 'indice_reajuste', indice_reajuste,
      'data_base', data_base, 'status', status, 'intragrupo', intragrupo, 'contrato_anexo', contrato_anexo))
    INTO v_out FROM public.hub_permuta WHERE id = p_id;
  RETURN v_out;
END
$function$;

-- fn_permuta_movimento_excluir: soft-delete de um movimento do extrato (o cálculo já ignora deleted_at).
-- Mesma guarda de fn_permuta_excluir (fn__guarda_empresa, fail-closed).
CREATE OR REPLACE FUNCTION public.fn_permuta_movimento_excluir(p_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.hub_permuta_movimento WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'movimento_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.hub_permuta_movimento
     SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = NULLIF(btrim(p_motivo), '')
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_permuta_obter(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_permuta_obter(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_obter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_permuta_obter(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_permuta_movimento_excluir(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_permuta_movimento_excluir(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_movimento_excluir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_permuta_movimento_excluir(uuid, text) TO service_role;

-- RD-95: chaves de ajuda "?" para as novas ações de CRUD (Editar/Excluir permuta, Excluir movimento).
-- Aditiva e idempotente: só conteúdo de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem, v.status
FROM (VALUES
  ('hub.permutas.editar', '/dashboard/hub/permutas', 'Permutas', 'Editar permuta',
   'Clique para corrigir os dados da permuta (valor, % de permuta, índice, data-base, obra, contratante).',
   'Permite corrigir um cadastro feito com valor/percentual/índice/data errados sem ter de recriar a permuta.',
   'Trocar o índice de reajuste de CUB-SC para outro, ou ajustar a data-base do contrato.',
   'Editar a permuta errada: confira o ativo/imóvel antes de salvar.',
   'hub', 12, 'publicado'),
  ('hub.permutas.excluir', '/dashboard/hub/permutas', 'Permutas', 'Excluir permuta',
   'Clique e informe o motivo. A permuta sai da lista; o histórico fica registrado (exclusão rastreável).',
   'Remove uma permuta cadastrada por engano, mantendo o rastro de quem excluiu e por quê (nunca apaga de verdade).',
   'Excluir uma permuta duplicada.',
   'Excluir quando o certo seria editar: se os dados só estão errados, use Editar.',
   'hub', 13, 'publicado'),
  ('hub.permutas.mov_excluir', '/dashboard/hub/permutas', 'Permutas', 'Excluir movimento',
   'Clique para remover um lançamento errado do extrato (ex.: NF com valor errado). Exclusão rastreável.',
   'Corrige o saldo quando um movimento foi lançado errado, sem apagar o histórico (soft-delete).',
   'Remover um movimento de material lançado em duplicidade.',
   'Excluir o movimento certo: confira a nota/valor antes de confirmar.',
   'hub', 14, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
