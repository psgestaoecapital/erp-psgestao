-- Cadastro de clientes (/dashboard/cadastros/pessoas) · RAIZ do documento DUPLO — coluna canônica.
-- Aditiva: cria UMA coluna GERADA (sem UPDATE em dado de cliente) e repoe a busca na canônica.
--
-- GAP RAIZ (auditor_pdca_2, RD-38, reauditoria 21/11): erp_clientes tem DUAS colunas de documento sem
-- sincronização — cnpj_cpf (text, origem antiga) e cpf_cnpj (varchar, origem CRM). A fonte dupla permite
-- divergência e duplicata por origem; itens paliativos (busca/lista com OR+coalesce) mascaram, não resolvem a raiz.
--
-- PROVA NO DADO (RD-38, 22/11, toda a base = 45.116 clientes):
--   ambos_vazios 26.221 · só cnpj_cpf 4.396 · só cpf_cnpj 7.283 · ambos iguais 7.214 · ambos em conflito 2.
--   Com documento = COALESCE(NULLIF(btrim(cnpj_cpf),''), NULLIF(btrim(cpf_cnpj),'')), 18.895 clientes passam a
--   ter UM documento canônico (idêntico à expressão que fn_cliente_buscar já exibia → result-neutral).
--
-- FIX (coluna GERADA das duas, como pedido pelo auditor):
--   * coluna canônica `documento` GENERATED ALWAYS ... STORED — preenchida automaticamente para TODAS as linhas
--     (inclusive as 45k históricas) SEM um UNICO UPDATE/DELETE em dado de cliente; sempre em dia a cada escrita
--     em qualquer das duas colunas de origem. Fonte única da verdade para busca/dedup daqui pra frente.
--   * fn_cliente_buscar passa a exibir e buscar por `documento` (antes: COALESCE repetido das duas colunas, com a
--     armadilha latente do COALESCE(cnpj_cpf, cpf_cnpj,'') que, se cnpj_cpf viesse '' em vez de NULL, descartaria o
--     cpf_cnpj). A NULLIF(btrim(...),'') da coluna gerada neutraliza essa armadilha.
--
-- RESULT-NEUTRAL: `documento` é EXATAMENTE a expressão de exibição que a própria fn_cliente_buscar já usava
--   (COALESCE(NULLIF(btrim(cnpj_cpf),''), NULLIF(btrim(cpf_cnpj),''))); a busca só troca a mesma expressão
--   (sem '' latente). Chave do JSON de retorno segue 'cnpj_cpf' (contrato do front intacto).
--
-- SEGURANÇA / RD-94.1: migration ADITIVA. Coluna gerada NÃO altera as colunas de origem nem apaga/edita dado de
--   cliente; RLS da tabela cobre a coluna nova (RLS é por linha); grants inalterados (ADD COLUMN não concede anon).
--   Todas as funções que inserem em erp_clientes usam lista EXPLÍCITA de colunas (conferido) → a coluna gerada,
--   omitida, não quebra nenhum INSERT. Tabela pequena (45k); o ADD COLUMN gerado reescreve dentro de lock_timeout
--   (provado em BEGIN...ROLLBACK). É SENSÍVEL (dado de cliente) → via revisao-eng-chefe.
-- RD-52: arquivo + PR, versão acima da main, faixa de segundos do agente (:35).

-- 1) Coluna canônica gerada (fonte única do documento)
ALTER TABLE public.erp_clientes
  ADD COLUMN IF NOT EXISTS documento text
  GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(cnpj_cpf), ''), NULLIF(btrim(cpf_cnpj::text), ''))) STORED;

COMMENT ON COLUMN public.erp_clientes.documento IS
  'Documento canônico (CPF/CNPJ) derivado das colunas de origem cnpj_cpf e cpf_cnpj. Coluna GERADA/STORED: '
  'use esta para busca, exibição e dedup. As duas colunas de origem são mantidas por compatibilidade.';

-- 2) Busca de cliente passa a exibir e buscar pela coluna canônica
CREATE OR REPLACE FUNCTION public.fn_cliente_buscar(p_company_id uuid, p_termo text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_termo text := btrim(coalesce(p_termo,'')); v_dig text; v_out jsonb;
BEGIN
  IF NOT public.is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF length(v_termo) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  v_dig := NULLIF(regexp_replace(v_termo, '\D', '', 'g'), '');
  SELECT jsonb_agg(j) INTO v_out FROM (
    SELECT jsonb_build_object(
      'cliente_id', c.id,
      'nome', COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '—'),
      'cnpj_cpf', c.documento,
      'cidade', c.cidade
    ) AS j
    FROM erp_clientes c
    WHERE c.company_id = p_company_id AND COALESCE(c.ativo, true)
      AND ( c.nome_fantasia ILIKE '%'||v_termo||'%'
         OR c.razao_social ILIKE '%'||v_termo||'%'
         OR (v_dig IS NOT NULL AND regexp_replace(COALESCE(c.documento, ''), '\D', '', 'g') ILIKE '%'||v_dig||'%') )
    ORDER BY COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '')
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10), 50))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;

-- Guarda da função SECURITY DEFINER (check_fn_guards): fecha chamada RPC direta por anon e
-- reafirma o acesso só de quem está logado (CREATE OR REPLACE preserva grants; o REVOKE anon é explícito).
REVOKE ALL ON FUNCTION public.fn_cliente_buscar(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_buscar(uuid, text, integer) TO authenticated, service_role;
