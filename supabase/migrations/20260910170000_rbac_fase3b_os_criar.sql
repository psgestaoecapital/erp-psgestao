-- ============================================================
-- RBAC industrial · Fase 3b — PRIMEIRO consumidor: fn_os_criar consulta a decisão nova
-- ============================================================
-- REGRA-MÃE (CEO): o RBAC APERTA SÓ ONDE FOI CONFIGURADO, NUNCA onde ainda não foi. Quem NÃO tem papel
-- (decidido.tem_papel=false) segue EXATAMENTE como hoje — só a checagem de pertencimento, sem RBAC.
-- Prova no dado (RD-38): a única empresa que abre OS de verdade é a KGF Autocenter (159 OS), e ela NÃO
-- tem nenhum papel configurado — todos os criadores (Gean sócio, mecânicos, adm) têm tem_papel=null →
-- caem no legado. Nenhuma empresa com papel (só a Frioeste) tem uma única OS. Logo, a trava é DORMENTE
-- para 100% da atividade de OS de hoje: ninguém para de trabalhar.
--
-- O QUE fn_os_criar PASSA A CHECAR (item 1 do CEO):
--   • subgrupo: 'operacao' (abrir/executar OS é trabalho operacional; e é um subgrupo CONFIGURADO —
--     os papéis o concedem. 'manutencao', apesar de nomear "ordem de servico" no catálogo, está VAZIO;
--     travar nele barraria todo papel-holder sem que nada tenha sido configurado);
--   • nível mínimo: 'editar' (criar = escrever; 'ver'/'filtrar' não abrem OS).
-- Só vale quando o usuário TEM papel; o nível do user_scope já entra como TETO dentro de 'acessos'.
-- Preserva TODA a lógica anterior (pertencimento, cliente, numeração, INSERT).

CREATE OR REPLACE FUNCTION public.fn_os_criar(p_company_id uuid, p_descricao_servico text, p_cliente_id uuid DEFAULT NULL::uuid, p_cliente_nome character varying DEFAULT NULL::character varying, p_cliente_cnpj character varying DEFAULT NULL::character varying, p_equipamento character varying DEFAULT NULL::character varying, p_defeito_relatado text DEFAULT NULL::text, p_tecnico_id uuid DEFAULT NULL::uuid, p_tecnico_nome character varying DEFAULT NULL::character varying, p_prioridade character varying DEFAULT 'normal'::character varying, p_placa character varying DEFAULT NULL::character varying, p_modelo character varying DEFAULT NULL::character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os     erp_os%ROWTYPE;
  v_numero varchar;
  vc       erp_clientes%ROWTYPE;
  v_nome   varchar;
  v_cnpj   varchar;
  v_end    text;
  v_dec    jsonb;     -- FASE 3b · decisão de acesso (aditiva)
  v_op     text;      -- nível efetivo no subgrupo 'operacao' (já capado pelo TETO)
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa nao informada');
  END IF;
  IF p_company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  -- FASE 3b · RBAC aperta SÓ onde foi configurado. Sem papel → legado (não mexe). Com papel → exige
  -- 'editar'/'aprovar' em 'operacao' pra abrir OS. Narrowing: papel que dá 'aprovar' num 'ver' vira 'ver'.
  -- BYPASS (decisão do CEO): o DONO da empresa cliente (papel_gestao=CLIENT_OWNER) e o ADMIN da PS
  -- (is_admin) passam POR CIMA do gate — respondem pela empresa/plataforma e não podem ser barrados de
  -- abrir OS. Isso mantém a regra-mãe: aperta onde foi configurado, nunca em cima de quem manda.
  -- Ex.: supervisoradm@ (Fabiane) é CLIENT_OWNER com papel 'ind_ger_administrativo' (sem 'operacao') —
  -- sem o bypass seria barrada de abrir OS na própria empresa.
  v_dec := public.fn_acesso_efetivo(auth.uid(), p_company_id);
  IF COALESCE((v_dec -> 'decidido' ->> 'tem_papel')::boolean, false)
     AND (v_dec ->> 'papel_gestao') IS DISTINCT FROM 'CLIENT_OWNER'
     AND NOT public.is_admin() THEN
    v_op := v_dec -> 'acessos' ->> 'operacao';
    IF v_op IS NULL OR v_op NOT IN ('editar','aprovar') THEN
      RETURN jsonb_build_object('ok', false, 'erro',
        'Seu papel de acesso não permite abrir Ordem de Serviço (é necessário nível "editar" em Operação). Peça a quem administra os acessos da empresa.');
    END IF;
  END IF;

  v_nome := NULLIF(btrim(COALESCE(p_cliente_nome,'')), '');
  v_cnpj := NULLIF(btrim(COALESCE(p_cliente_cnpj,'')), '');

  IF p_cliente_id IS NOT NULL THEN
    SELECT * INTO vc FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
    IF FOUND THEN
      v_nome := COALESCE(v_nome, NULLIF(btrim(COALESCE(vc.nome_fantasia,'')),''), NULLIF(btrim(COALESCE(vc.razao_social,'')),''));
      v_cnpj := COALESCE(v_cnpj, NULLIF(btrim(COALESCE(vc.cpf_cnpj,'')),''));
      v_end := NULLIF(btrim(concat_ws(', ',
                 NULLIF(btrim(concat_ws(' ', vc.logradouro, vc.numero)), ''),
                 NULLIF(btrim(COALESCE(vc.bairro,'')), ''),
                 NULLIF(btrim(concat_ws('/', NULLIF(btrim(COALESCE(vc.cidade,'')),''), NULLIF(btrim(COALESCE(vc.uf,'')),''))), '')
               )), '');
    END IF;
  END IF;

  v_numero := next_os_numero(p_company_id);

  INSERT INTO erp_os (
    company_id, numero, descricao_servico,
    cliente_id, cliente_nome, cliente_cnpj, endereco_servico,
    equipamento, defeito_relatado,
    tecnico_id, tecnico_nome, prioridade,
    placa, modelo,
    status, data_abertura, created_by
  ) VALUES (
    p_company_id, v_numero,
    COALESCE(NULLIF(btrim(p_descricao_servico),''), 'Ordem de servico'),
    p_cliente_id, v_nome, v_cnpj, v_end,
    p_equipamento, p_defeito_relatado,
    p_tecnico_id, p_tecnico_nome, COALESCE(NULLIF(p_prioridade,''),'normal'),
    NULLIF(upper(regexp_replace(COALESCE(p_placa,''), '[^A-Za-z0-9]', '', 'g')), ''),
    NULLIF(btrim(COALESCE(p_modelo,'')), ''),
    'aberta', CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false,
    'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $function$;
