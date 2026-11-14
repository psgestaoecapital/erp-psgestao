-- Oficina · Comissão (/dashboard/oficina/comissao) — RD-98: CRUD incompleto na lista de REGRAS DE COMISSÃO
-- ============================================================================
-- GAP (PDCA aud8 13/11): a lista "Regras de comissão" só tinha INCLUIR (fn_oficina_comissao_regra_salvar).
--   Era somente-leitura: sem Editar e sem Excluir/Desativar, apesar de erp_oficina_comissao_regra ter a
--   coluna `ativo`. RD-98 p2: incluir, editar e excluir têm de estar visíveis.
-- CORREÇÃO (aditiva, idempotente):
--   1) fn_oficina_comissao_regra_excluir(company,id) — DESATIVA (ativo=false, não apaga histórico) com
--      guarda por empresa (get_user_company_ids/is_admin), SECURITY DEFINER, REVOKE anon (mesmo padrão do
--      _salvar). "Editar" reusa o _salvar: ele já desativa a regra ativa do mesmo mecânico antes de inserir
--      (upsert por nome) — o front só precisa pré-preencher o formulário.
--   2) RD-95: chave de ajuda "?" para a lista de regras (explica Editar e Excluir), que a tela ainda não tinha.
-- RD-38: função nova (nada de dado de cliente alterado); ON CONFLICT (chave) DO UPDATE no ajuda = re-rodar não duplica.
-- RD-100: linguagem do usuário, sem nome de terceiro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oficina_comissao_regra_excluir(p_company_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  UPDATE erp_oficina_comissao_regra
     SET ativo = false
   WHERE id = p_id AND company_id = p_company_id AND ativo = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'regra nao encontrada');
  END IF;
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_oficina_comissao_regra_excluir(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comissao_regra_excluir(uuid, uuid) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.comissao.regras_lista', '/dashboard/oficina/comissao', 'Oficina', 'Regras cadastradas',
   'Não é um campo: é a lista das regras de comissão já cadastradas. Em cada regra, use "Editar" para trazer os valores ao formulário abaixo e salvar por cima, ou "Excluir" para desativar a regra (ela deixa de valer no cálculo).',
   'Permite corrigir ou remover uma regra sem precisar apagar e recadastrar — mantém o controle de quem comissiona por quê.',
   'Editar a regra do mecânico "João" de 10% para 12%, ou excluir uma regra "Padrão (todos)" que não se usa mais.',
   'Excluir a regra achando que apaga a comissão já calculada — ela só para de valer daqui pra frente; o cálculo do período já fechado não muda.',
   'oficina', 10)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
