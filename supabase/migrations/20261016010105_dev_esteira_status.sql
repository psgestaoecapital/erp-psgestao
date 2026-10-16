-- Aba Codes · faixa da esteira: "teste da main" e "fila de testes" (CEO 08/10 09:30). Faixa 05 (gilberto-produto).
-- Tabela pequena, uma linha por chave: 'main' (último resultado da aceitação da main) e 'fila' (runs esperando no grupo
-- aceitacao-testes). Mesma RLS da erp_dev_entrega: só equipe PS lê; só service_role grava; nada ao anon. Realtime ligado.
CREATE TABLE IF NOT EXISTS public.erp_dev_esteira_status (
  chave         text PRIMARY KEY CHECK (chave IN ('main','fila')),
  verde         boolean,
  quantidade    integer CHECK (quantidade IS NULL OR quantidade >= 0),
  run_url       text,
  ocorrido_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_dev_esteira_status IS
  'Estado da esteira para a aba Codes: main (verde/vermelho da aceitação da main) e fila (runs esperando em aceitacao-testes). Gravada só pelo workflow registrar-esteira.yml (service_role). Leitura só equipe PS.';

ALTER TABLE public.erp_dev_esteira_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_dev_esteira_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_dev_esteira_status TO authenticated;
GRANT ALL ON TABLE public.erp_dev_esteira_status TO service_role;
DROP POLICY IF EXISTS erp_dev_esteira_status_sel_equipe_ps ON public.erp_dev_esteira_status;
CREATE POLICY erp_dev_esteira_status_sel_equipe_ps ON public.erp_dev_esteira_status
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'erp_dev_esteira_status') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_dev_esteira_status;
  END IF;
END $$;
