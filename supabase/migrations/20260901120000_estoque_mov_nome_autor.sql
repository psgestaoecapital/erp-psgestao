-- §6 · Movimentação de estoque: nome do produto e AUTOR resolvidos na LEITURA (RD-52).
-- Achado (RD-44): o autor NUNCA se perdeu — usuario_id está preenchido em 694/702; usuario_nome
-- (cópia denormalizada) está vazio em 702/702. Os dois bugs da Jordana são o mesmo: a tela não faz JOIN.
-- Decisão: NÃO preencher usuario_nome (mantém a mentira possível). Resolver na leitura a partir de
-- usuario_id (fonte de verdade) e de produto_id. Resolve as 702 históricas SEM UPDATE nenhum.
-- usuario_nome NÃO é derrubada (RD-30) — fica órfã e para de ser escrita (§2.3).

-- fn_usuario_nome: full_name por id. SECURITY DEFINER porque o nome de exibição do operador precisa
-- resolver para QUALQUER autor (não só o próprio, que a RLS de users limitaria). É só o nome de quem
-- mexeu no estoque DENTRO da empresa — feature legítima.
CREATE OR REPLACE FUNCTION public.fn_usuario_nome(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT full_name FROM public.users WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.fn_usuario_nome(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_usuario_nome(uuid) TO authenticated, service_role;

-- v_estoque_movimentacoes: as movimentações com produto e autor resolvidos.
-- security_invoker=on → RLS de erp_estoque_movimentacoes/erp_produtos (escopo por empresa) continua
-- valendo; o NOME do autor vem do helper SECURITY DEFINER acima. Sem FK produto→erp_produtos, JOIN por id.
CREATE OR REPLACE VIEW public.v_estoque_movimentacoes WITH (security_invoker=on) AS
  SELECT m.*,
         p.nome   AS produto_nome,
         p.codigo AS produto_codigo,
         fn_usuario_nome(m.usuario_id) AS usuario_nome_resolvido
  FROM public.erp_estoque_movimentacoes m
  LEFT JOIN public.erp_produtos p ON p.id = m.produto_id;
GRANT SELECT ON public.v_estoque_movimentacoes TO authenticated, service_role;
