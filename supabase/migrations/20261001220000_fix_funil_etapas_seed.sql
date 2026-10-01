-- DEFEITO (achado pelo teste do roteiro da Pdois, 01/10): fn_funil_etapas_listar quebrava ao criar o funil padrão de
-- leads ("column reference \"chave\" is ambiguous" — o ON CONFLICT (…, chave) colide com a coluna "chave" que a função
-- devolve). Toda empresa SEM etapas (agência nova, demo depois do reset) ficava com a tela de Leads em "Nenhuma etapa
-- configurada" e os leads não apareciam no funil. Hoje só a Agência (P&M) - DEMO está assim; a Pdois já tem as 6 etapas.
-- Correção: o conflito é apontado pelo NOME da restrição única. Mesmo comportamento, mesmas 6 etapas.
CREATE OR REPLACE FUNCTION public.fn_funil_etapas_listar(p_company_id uuid, p_tipo_funil text)
 RETURNS TABLE(id uuid, chave text, rotulo text, ordem integer, cor text, tipo_etapa text, ativo boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;

  IF p_tipo_funil = 'leads'
     AND NOT EXISTS (SELECT 1 FROM funil_etapa fe WHERE fe.company_id = p_company_id AND fe.tipo_funil = 'leads') THEN
    INSERT INTO funil_etapa (company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa)
    SELECT p_company_id, 'leads', d.chave, d.rotulo, d.ordem, d.cor, d.tipo
    FROM (VALUES
      ('novo_atendimento','Novo Atendimento',10,'#F0E9DE','normal'),
      ('reuniao','Reunião',20,'#FCE9C2','normal'),
      ('proposta','Proposta',30,'#F4B860','normal'),
      ('negociacao','Negociação',40,'#E8A93A','normal'),
      ('ganho','Ganho',50,'#DCEFD7','ganho'),
      ('perdido','Perdido',60,'#F4D6D6','perda')
    ) AS d(chave,rotulo,ordem,cor,tipo)
    ON CONFLICT ON CONSTRAINT funil_etapa_company_id_tipo_funil_chave_key DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT fe.id, fe.chave, fe.rotulo, fe.ordem, fe.cor, fe.tipo_etapa, fe.ativo
    FROM funil_etapa fe
    WHERE fe.company_id = p_company_id AND fe.tipo_funil = p_tipo_funil AND fe.ativo = true
    ORDER BY fe.ordem, fe.rotulo;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_funil_etapas_listar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_funil_etapas_listar(uuid, text) TO authenticated, service_role;
