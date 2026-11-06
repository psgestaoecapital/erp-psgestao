-- PDCA Hub (auditor_pdca_1, /dashboard/projetos/clientes · "indicador de status do orçamento por cliente — orçamento
-- sem itens é trava crítica do blueprint"): a tela já liga cliente → oportunidade → proposta → obra, mas não dizia
-- quais clientes têm orçamento SEM itens (catálogo×qtd=custo vazio). Prova no dado (RD-38, DEMO construção
-- b0700000-...-004): 968 de 978 orçamentos sem itens. Esta migration é ADITIVA:
--   1) função set-based que conta, por cliente, orçamentos sem/com itens (uma consulta agregada por empresa — NÃO
--      chama função por linha; respeita RLS por ser SECURITY INVOKER, o usuário só enxerga a própria empresa);
--   2) a chave do "?" (RD-95) do novo indicador.
-- Não cria/altera/apaga dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_clientes_orcamentos_sem_itens(p_company uuid)
RETURNS TABLE (cliente_id uuid, sem_itens bigint, com_itens bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT o.cliente_id,
         count(*) FILTER (WHERE COALESCE(it.n, 0) = 0) AS sem_itens,
         count(*) FILTER (WHERE COALESCE(it.n, 0) > 0) AS com_itens
  FROM public.erp_orcamentos o
  LEFT JOIN (
    SELECT i.orcamento_id, count(*) AS n
    FROM public.erp_orcamentos_itens i
    WHERE i.company_id = p_company
    GROUP BY i.orcamento_id
  ) it ON it.orcamento_id = o.id
  WHERE o.company_id = p_company AND o.cliente_id IS NOT NULL
  GROUP BY o.cliente_id;
$$;

REVOKE ALL ON FUNCTION public.fn_clientes_orcamentos_sem_itens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_clientes_orcamentos_sem_itens(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
('projetos.clientes.comercial.orcamentos_sem_itens','/dashboard/projetos/clientes','Indicadores','hub_projetos',45,'Orçamentos sem itens','Indicador calculado, não se preenche. Conta quantos orçamentos (propostas) do cliente ainda estão sem nenhum item lançado (serviço ou produto do catálogo).','Aponta a trava crítica da jornada do dinheiro: orçamento sem item não tem custo nem preço calculável, então não vira pedido nem obra. Toque em Propostas para completar os itens.','2 sem itens','Deixar o orçamento só com o cabeçalho (cliente/endereço) e esquecer de lançar os itens: ele fica parado e não fatura.')
ON CONFLICT (chave) DO NOTHING;
