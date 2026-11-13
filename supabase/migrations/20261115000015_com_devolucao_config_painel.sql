-- Painel de vendas (CEO 12/11) · /dashboard/comercial/meu-painel — filtro de DEVOLUÇÕES "o que conta".
-- Na Frioeste ~90% do devolvido é reprocessado e revendido, então a devolução "cheia" distorce o indicador.
-- O usuário escolhe, por NOME de produto e por LINHA, o que ENTRA no indicador; o painel mostra
-- "Devolução bruta" × "Devolução considerada". A escolha agora é SALVA POR EMPRESA no banco (antes só no
-- navegador). Preparado para, no futuro, descontar o reprocessado sem nova PR de tela (CEO deferiu).
--
-- TUDO ADITIVO e idempotente: tabela nova (RLS por empresa, REVOKE anon, escrita só por RPC com guarda),
-- 2 funções novas, 1 chave de ajuda (RD-95) e registro em system_screens (RD-98). Nenhuma função/view/policy
-- existente é alterada; nenhum dado de cliente é tocado. Guarda padrão do projeto:
-- company_id IN (SELECT get_user_company_ids()) OR is_admin().

-- 1) Config por empresa (uma linha por empresa). Arrays de NOMES (resistentes a mudança de ordem da base).
CREATE TABLE IF NOT EXISTS public.com_devolucao_config (
  company_id     uuid PRIMARY KEY,
  produtos_fora  text[] NOT NULL DEFAULT '{}',
  linhas_fora    text[] NOT NULL DEFAULT '{}',
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

ALTER TABLE public.com_devolucao_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS com_devolucao_config_select ON public.com_devolucao_config;
CREATE POLICY com_devolucao_config_select ON public.com_devolucao_config
  FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.com_devolucao_config FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.com_devolucao_config FROM authenticated;
GRANT SELECT ON public.com_devolucao_config TO authenticated;
GRANT ALL ON public.com_devolucao_config TO service_role;

-- 2) LER a config (fail-closed: sem acesso ou sem linha → tudo conta, bruta = considerada).
CREATE OR REPLACE FUNCTION public.fn_com_devolucao_config_ler(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_r com_devolucao_config%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('produtos_fora', '[]'::jsonb, 'linhas_fora', '[]'::jsonb);
  END IF;
  SELECT * INTO v_r FROM com_devolucao_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('produtos_fora', '[]'::jsonb, 'linhas_fora', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'produtos_fora', to_jsonb(v_r.produtos_fora),
    'linhas_fora',   to_jsonb(v_r.linhas_fora));
END $function$;

-- 3) SALVAR a config (upsert) — guarda de empresa + audit. Nunca aceita empresa fora do acesso do usuário.
CREATE OR REPLACE FUNCTION public.fn_com_devolucao_config_salvar(
  p_company_id uuid, p_produtos_fora text[], p_linhas_fora text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ant com_devolucao_config%ROWTYPE;
        v_prod text[] := COALESCE(p_produtos_fora, '{}'); v_lin text[] := COALESCE(p_linhas_fora, '{}');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  SELECT * INTO v_ant FROM com_devolucao_config WHERE company_id = p_company_id;

  INSERT INTO com_devolucao_config AS c (company_id, produtos_fora, linhas_fora, atualizado_em, atualizado_por)
  VALUES (p_company_id, v_prod, v_lin, now(), v_uid)
  ON CONFLICT (company_id) DO UPDATE SET
    produtos_fora = EXCLUDED.produtos_fora, linhas_fora = EXCLUDED.linhas_fora,
    atualizado_em = now(), atualizado_por = v_uid;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'com_devolucao_config', p_company_id::text,
          CASE WHEN v_ant.company_id IS NULL THEN 'devolucao_config_criar' ELSE 'devolucao_config_editar' END,
          CASE WHEN v_ant.company_id IS NULL THEN NULL
               ELSE jsonb_build_object('produtos_fora', v_ant.produtos_fora, 'linhas_fora', v_ant.linhas_fora) END,
          jsonb_build_object('produtos_fora', v_prod, 'linhas_fora', v_lin));

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_com_devolucao_config_ler(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_com_devolucao_config_salvar(uuid, text[], text[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_com_devolucao_config_ler(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_com_devolucao_config_salvar(uuid, text[], text[]) TO authenticated, service_role;

-- 4) RD-95: "?" do novo indicador "Devolução considerada".
INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('com.painel.devolucao_considerada', '/dashboard/comercial/meu-painel', 'Devolução considerada',
  'Toque no card para escolher o que conta — por produto e por linha.',
  'Mostra a devolução que realmente pesa no seu resultado. "Bruta" é tudo o que voltou; "considerada" é a bruta menos o que você tirou do indicador (ex.: itens que são reprocessados e revendidos). A % é sobre o faturamento do período.',
  'Bruta R$ 566.799; tirando a linha reprocessada, a considerada cai para R$ 56.000 (10% do volume que de fato virou perda).',
  'Tirar um item do indicador NÃO apaga a devolução: ela continua no "bruto"; só deixa de contar no número considerado.')
ON CONFLICT (chave) DO NOTHING;

-- 5) RD-98 p3: origem do dado da tela (append idempotente das RPCs realmente consumidas).
UPDATE public.system_screens
SET rpcs_chamadas = (
  SELECT array_agg(DISTINCT e ORDER BY e)
  FROM unnest(COALESCE(rpcs_chamadas, '{}') ||
       ARRAY['fn_bi_comercial_base', 'fn_com_devolucao_config_ler', 'fn_com_devolucao_config_salvar']) AS e)
WHERE rota = '/dashboard/comercial/meu-painel';
