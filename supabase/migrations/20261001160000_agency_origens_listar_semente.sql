-- Defeito achado pelo veredito @pos-migration da #1955 (#552 Pdois, 01/10): fn_agency_origens_listar SEMEIA a lista
-- padrão de origens na 1ª vez que a empresa abre os leads, mas o INSERT … ON CONFLICT (company_id, chave) quebra com
-- 42702 "column reference chave is ambiguous" — a função devolve TABLE(… chave …), e a coluna de saída colide com a
-- coluna da tabela no alvo do ON CONFLICT. Resultado: empresa SEM lista (agência nova, demo depois do reset) não
-- consegue abrir o formulário de lead — e, sem a lista, o gatilho da #1955 só aceita as 4 origens antigas.
-- Correção: #variable_conflict use_column (nos nomes ambíguos vale a coluna da tabela). Corpo, guarda e retorno iguais.
-- Nenhum dado é alterado por esta migration; empresa que já tem lista (ex.: Pdois) não muda nada.

CREATE OR REPLACE FUNCTION public.fn_agency_origens_listar(p_company_id uuid)
 RETURNS TABLE(id uuid, chave text, nome text, ordem integer, ativo boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM agency_lead_origem o WHERE o.company_id = p_company_id) THEN
    INSERT INTO agency_lead_origem (company_id, chave, nome, ordem)
    SELECT p_company_id, d.chave, d.nome, d.ordem
    FROM (VALUES
      ('whatsapp','WhatsApp',10),
      ('site','Site',20),
      ('indicacao','Indicação',30),
      ('trafego_pago','Tráfego Pago',40),
      ('ligacao','Ligação',50),
      ('email','E-mail',60),
      ('evento','Evento',70),
      ('relacionamento','Relacionamento',80),
      ('prospeccao_ia_fria','Prospecção IA (fria)',90)
    ) AS d(chave,nome,ordem)
    ON CONFLICT (company_id, chave) DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT o.id, o.chave, o.nome, o.ordem, o.ativo
    FROM agency_lead_origem o
    WHERE o.company_id = p_company_id AND o.ativo = true
    ORDER BY o.ordem, o.nome;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_origens_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_origens_listar(uuid) TO authenticated;
