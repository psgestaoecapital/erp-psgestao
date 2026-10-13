-- Resultado por obra — versão receita (CEO 30/09 · Diego/FC). Na ficha da obra no Hub, um cartão com:
--   faturado  = soma das NFS-e AUTORIZADAS ligadas à obra (erp_nfse_emitidas.obra_id), valor bruto dos serviços;
--   recebido  = o que entrou nos títulos dessas notas (erp_nfse_emitidas.erp_receber_id): soma das baixas
--               (erp_receber_baixa, sem as excluídas); título antigo sem baixa registrada usa valor_pago;
--   a_receber = saldo dos títulos em aberto dessas notas;
--   notas_sem_titulo = nota autorizada sem título no financeiro (faturou e não há o que receber — avisa).
-- Custo NÃO entra aqui (a tela mostra "a partir de novembro", junto com o centro de custo de verdade).
-- Prova no dado (30/09): nos 67 títulos pagos ligados a NFS-e autorizada, valor_pago = soma das baixas (0 divergem).
-- Só leitura. A empresa tem de ser do usuário (mesma guarda de fn_obras_listar).

CREATE OR REPLACE FUNCTION public.fn_obras_receita(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, faturado numeric, recebido numeric, a_receber numeric, notas integer, notas_sem_titulo integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH notas AS (
    SELECT n.obra_id, n.id, COALESCE(n.valor_bruto, n.valor_servicos, 0) AS bruto, n.erp_receber_id
      FROM public.erp_nfse_emitidas n
     WHERE n.company_id = ANY(p_company_ids)
       AND n.company_id IN (SELECT public.get_user_company_ids())
       AND n.obra_id IS NOT NULL
       AND n.status = 'autorizada'
  ), titulos AS (
    SELECT DISTINCT ON (r.id) nt.obra_id, r.id, r.valor, r.status,
           COALESCE((SELECT sum(b.valor) FROM public.erp_receber_baixa b WHERE b.receber_id = r.id AND b.deleted_at IS NULL),
                    CASE WHEN r.status = 'pago' THEN COALESCE(r.valor_pago, r.valor) ELSE COALESCE(r.valor_pago, 0) END) AS entrou
      FROM notas nt
      JOIN public.erp_receber r ON r.id = nt.erp_receber_id
     WHERE r.deleted_at IS NULL AND r.status <> 'cancelado'
  )
  SELECT o.id,
         COALESCE((SELECT sum(nt.bruto) FROM notas nt WHERE nt.obra_id = o.id), 0)::numeric(14,2),
         COALESCE((SELECT sum(t.entrou) FROM titulos t WHERE t.obra_id = o.id), 0)::numeric(14,2),
         COALESCE((SELECT sum(GREATEST(t.valor - t.entrou, 0)) FROM titulos t WHERE t.obra_id = o.id AND t.status <> 'pago'), 0)::numeric(14,2),
         (SELECT count(*) FROM notas nt WHERE nt.obra_id = o.id)::int,
         (SELECT count(*) FROM notas nt WHERE nt.obra_id = o.id AND nt.erp_receber_id IS NULL)::int
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids());
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_receita(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_receita(uuid[]) TO authenticated, service_role;
