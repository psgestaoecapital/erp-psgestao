-- Chamado #9986 (jordana-chat) — "aguardando" só pode aparecer quando a ação de quem é
-- aguardado já está liberada e visível. ITEM 4 (verificação automática diária): camada de
-- DETECÇÃO, apenas leitura. Lista os chamados em status "aguardando*" que NÃO têm ação
-- pendente correspondente — o estado "enganoso" que o chamado descreve (ex.: #3863/PR 5215):
-- a tela mostra "aguardando" mas não existe pedido na bandeja de aprovações nem a resposta
-- foi liberada ao autor, então ninguém recebe aviso para agir e o chamado fica parado.
--
-- Esta migration é ADITIVA e SÓ LEITURA (RD-94.1 c): não cria/altera conta, não move dinheiro,
-- não muda status nem fluxo de resposta (essa parte — devolver p/ "em andamento" ou criar a
-- ação que falta — é a fatia que depende de OK de escopo, fora daqui). A função não recebe
-- parâmetro, não grava, e é SECURITY DEFINER só para uso de serviço (cron da verificação diária
-- e painel do Eng. Chefe). Não devolve título nem dado pessoal — só número do chamado, PR e
-- flags — e é concedida apenas a service_role (sem anon/public), sem risco de vazamento LGPD.
--
-- Prova RD-38 (produção, 19/11/2026): 67 chamados em "aguardando_confirmacao", 9 liberadas
-- (resposta_aprovada=true) e 57 "enganosas" (PR existe, resposta NÃO liberada e sem bandeja) —
-- confere com a prova do próprio chamado (66/9/57).

CREATE OR REPLACE FUNCTION public.fn_chamados_aguardando_enganoso()
RETURNS TABLE (
  chamado_id             uuid,
  numero                 integer,
  status                 text,
  pr_numero              integer,
  resposta_aprovada      boolean,
  confirmado_pelo_autor  boolean,
  tem_pedido_na_bandeja  boolean,
  motivo                 text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.numero,
    s.status,
    s.pr_numero,
    s.resposta_aprovada,
    s.confirmado_pelo_autor,
    EXISTS (SELECT 1 FROM public.erp_pr_bandeja b WHERE b.pr_numero = s.pr_numero) AS tem_pedido_na_bandeja,
    CASE
      WHEN s.pr_numero IS NOT NULL
           AND s.resposta_aprovada IS NOT TRUE
           AND NOT EXISTS (SELECT 1 FROM public.erp_pr_bandeja b WHERE b.pr_numero = s.pr_numero)
        THEN 'pr_sem_pedido_na_bandeja'            -- PR aberto/mergeado mas sem pedido de aprovação visível
      WHEN s.pr_numero IS NULL
           AND s.resposta_aprovada IS NOT TRUE
        THEN 'sem_pr_e_sem_resposta_liberada'      -- "aguardando" sem nada que justifique a espera
    END AS motivo
  FROM public.sugestoes s
  WHERE s.status ILIKE 'aguardando%'
    -- "enganoso" = a espera não tem ação pendente correspondente.
    -- Liberadas de verdade (resposta_aprovada=true) ficam de fora.
    AND s.resposta_aprovada IS NOT TRUE
    AND NOT (
      s.pr_numero IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.erp_pr_bandeja b WHERE b.pr_numero = s.pr_numero)
    )
  ORDER BY s.numero;
$$;

COMMENT ON FUNCTION public.fn_chamados_aguardando_enganoso() IS
  'Chamado #9986 item 4 — detecção (só leitura) dos chamados em "aguardando" sem ação pendente correspondente (PR sem pedido na bandeja, ou sem PR e sem resposta liberada). Uso de serviço: cron diário + painel do Eng. Chefe.';

REVOKE ALL ON FUNCTION public.fn_chamados_aguardando_enganoso() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_chamados_aguardando_enganoso() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_aguardando_enganoso() TO service_role;
