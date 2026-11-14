-- Chamado #5452 (Pdois/P&M) · Modelos de contrato — F2 (slice A): campos obrigatórios × opcionais.
-- Direção do Eng. Chefe (msg 1da42d66): depois do "Subir modelo (PDF/Word)" e do "Sugerir campos com IA",
-- o autor do modelo passa a poder MARCAR quais campos variáveis ({{campo}}) são OBRIGATÓRIOS — os que
-- precisam estar preenchidos ao gerar o contrato. Esta slice entrega o ARMAZENAMENTO + a marcação na tela;
-- a sinalização no momento de gerar (fn_contrato_modelo_gerar) é a slice B, quando a tela de geração existir.
--
-- ADITIVA e DESLIGADA POR PADRÃO (RD-97): coluna nova com DEFAULT '{}' (nenhum modelo nasce com obrigatório),
-- função NOVA para definir a lista e fn_contrato_modelo_listar passa a devolver a coluna. NADA destrutivo,
-- nada que regrida: modelo sem marcação se comporta exatamente como hoje. fn_contrato_modelo_salvar fica
-- INTOCADA de propósito — assim o save do modelo continua funcionando no preview da PR (onde a migration
-- ainda não rodou); a persistência do obrigatório é uma chamada à parte, best-effort na tela, que só passa
-- a valer quando esta migration chega à produção.
-- RLS: a tabela já tem policy por company_id + REVOKE anon (20261105005645). A função nova é SECURITY DEFINER
-- com guarda de empresa explícita e REVOKE anon. Idempotente. Versão acima da main, faixa de segundos :45–:54.

-- 1) Coluna nova (aditiva, default vazio) ---------------------------------------------------------------
ALTER TABLE public.erp_contrato_modelo
  ADD COLUMN IF NOT EXISTS campos_obrigatorios text[] NOT NULL DEFAULT '{}'::text[];

-- 2) Função NOVA: definir os campos obrigatórios de um modelo (versão) ----------------------------------
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_campos_obrigatorios_definir(
  p_company_id uuid,
  p_modelo_id  uuid,
  p_campos     text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[];
  v_found  boolean;
BEGIN
  -- guarda de empresa (conexão de serviço tem auth.uid() NULL e passa; usuário só a própria empresa)
  IF p_company_id IS NULL
     OR (auth.uid() IS NOT NULL AND NOT public.is_admin()
         AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- normaliza: distintos, sem espaços, sem vazios, só chaves de campo (letras/números/_)
  SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}'::text[]) INTO v_campos
  FROM (
    SELECT btrim(x) AS c
    FROM unnest(COALESCE(p_campos, '{}'::text[])) AS x
  ) q
  WHERE c <> '' AND c ~ '^[a-zA-Z0-9_]+$';

  UPDATE public.erp_contrato_modelo
     SET campos_obrigatorios = v_campos,
         atualizado_em       = now()
   WHERE id = p_modelo_id
     AND company_id = p_company_id
     AND excluido_em IS NULL
  RETURNING true INTO v_found;

  IF NOT v_found THEN
    RAISE EXCEPTION 'Modelo de contrato não encontrado' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true, 'modelo_id', p_modelo_id, 'campos_obrigatorios', to_jsonb(v_campos));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_campos_obrigatorios_definir(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_campos_obrigatorios_definir(uuid, uuid, text[]) TO authenticated, service_role;

-- 3) listar passa a devolver campos_obrigatorios (mesma assinatura — replace seguro) --------------------
CREATE OR REPLACE FUNCTION public.fn_contrato_modelo_listar(p_company_id uuid, p_incluir_inativos boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_company_id IS NULL
     OR (auth.uid() IS NOT NULL AND NOT public.is_admin()
         AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'nome')), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', mo.id,
      'modelo_grupo', mo.modelo_grupo,
      'versao', mo.versao,
      'nome', mo.nome,
      'descricao', mo.descricao,
      'texto', mo.texto,
      'ativo', mo.ativo,
      'campos_obrigatorios', COALESCE(to_jsonb(mo.campos_obrigatorios), '[]'::jsonb),
      'criado_em', mo.criado_em,
      'atualizado_em', mo.atualizado_em
    ) AS m
    FROM public.erp_contrato_modelo mo
    WHERE mo.company_id = p_company_id
      AND mo.excluido_em IS NULL
      AND (p_incluir_inativos OR mo.ativo = true)
  ) q;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id, 'modelos', v_rows);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_contrato_modelo_listar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_modelo_listar(uuid, boolean) TO authenticated, service_role;

-- 4) Texto de ajuda "?" (RD-95) da nova marcação --------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/contratos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contrato.modelo.campos_obrigatorios', 'Modelos de contrato', 'Campos obrigatórios',
  'Nada a digitar: clique em um campo variável usado no texto para marcá-lo como obrigatório (com *). Clique de novo para voltar a opcional.',
  'Marca quais dados precisam estar preenchidos antes de gerar o contrato a partir deste modelo — evita emitir contrato com lacunas (ex.: valor ou prazo em branco).',
  'Em um fee mensal, marcar "Valor mensal" e "Data de início" como obrigatórios; "Condições específicas" fica opcional.',
  'Marcar um campo que não aparece no texto não tem efeito: só os campos {{usados}} no modelo entram como obrigatórios.', 7)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
