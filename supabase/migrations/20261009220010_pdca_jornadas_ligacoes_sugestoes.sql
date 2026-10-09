-- PDCA automático de qualidade (CEO 09/10) — fatia 1 (P): catálogo de jornadas, mapa de ligações e banco de sugestões.
-- ADITIVA: só tabelas novas (catálogo global, sem dado de cliente). RLS ligada; só admin lê/escreve; anon sem acesso.
CREATE TABLE IF NOT EXISTS public.erp_pdca_jornada (
  id           bigserial PRIMARY KEY,
  vertical     text NOT NULL,
  jornada      text NOT NULL,
  passo        int  NOT NULL,
  rota         text,
  acao         text NOT NULL,
  deve_aparecer text,
  sql_conferencia text,          -- consulta (só SELECT) do número que tem de bater, rodada na DEMO da vertical
  regras       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, jornada, passo)
);
CREATE TABLE IF NOT EXISTS public.erp_pdca_ligacao (
  id           bigserial PRIMARY KEY,
  vertical     text NOT NULL,
  origem       text NOT NULL,
  acao         text NOT NULL,
  destino      text NOT NULL,
  deve_aparecer text,
  sql_conferencia text,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, origem, acao, destino)
);
CREATE TABLE IF NOT EXISTS public.erp_pdca_sugestao (
  id           bigserial PRIMARY KEY,
  vertical     text NOT NULL,
  tela         text,
  eixo         text NOT NULL CHECK (eixo IN ('facilidade','produtividade','custo','vantagem_concorrente')),
  texto        text NOT NULL,
  impacto_estimado text,
  blueprint_secao text,
  blueprint_texto_sugerido text,
  status       text NOT NULL DEFAULT 'sugerida' CHECK (status IN ('sugerida','aprovada','recusada','virou_onda')),
  ciclo_id     bigint,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  decidido_em  timestamptz
);
ALTER TABLE public.erp_pdca_jornada   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pdca_ligacao   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pdca_sugestao  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_pdca_jornada, public.erp_pdca_ligacao, public.erp_pdca_sugestao FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS erp_pdca_jornada_admin ON public.erp_pdca_jornada;
CREATE POLICY erp_pdca_jornada_admin ON public.erp_pdca_jornada FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS erp_pdca_ligacao_admin ON public.erp_pdca_ligacao;
CREATE POLICY erp_pdca_ligacao_admin ON public.erp_pdca_ligacao FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS erp_pdca_sugestao_admin ON public.erp_pdca_sugestao;
CREATE POLICY erp_pdca_sugestao_admin ON public.erp_pdca_sugestao FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON public.erp_pdca_jornada, public.erp_pdca_ligacao, public.erp_pdca_sugestao TO authenticated;
GRANT ALL ON public.erp_pdca_jornada, public.erp_pdca_ligacao, public.erp_pdca_sugestao TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Primeiras jornadas (sem SQL de conferência ainda: entram na fatia D, junto com o robô).
INSERT INTO public.erp_pdca_jornada (vertical, jornada, passo, rota, acao, deve_aparecer) VALUES
 ('hub','cliente_a_resultado',1,'/dashboard/projetos/clientes','Cadastrar cliente','Cliente na lista'),
 ('hub','cliente_a_resultado',2,'/dashboard/projetos/oportunidades','Criar oportunidade para o cliente','Oportunidade no funil'),
 ('hub','cliente_a_resultado',3,'/dashboard/projetos/propostas','Gerar proposta com itens','Proposta com total'),
 ('hub','cliente_a_resultado',4,'/dashboard/projetos/oportunidades','Marcar como ganha','Obra criada a partir da oportunidade'),
 ('hub','cliente_a_resultado',5,'/dashboard/projetos/obras','Abrir a obra','Obra em andamento com etapas'),
 ('hub','cliente_a_resultado',6,'/dashboard/projetos/compras','Lançar compra da obra','Compra ligada à obra'),
 ('hub','cliente_a_resultado',7,'/dashboard/projetos/painel','Ver resultado','Painel com custo e margem da obra'),
 ('ge','pagar_a_dre',1,'/dashboard/financeiro/pagar','Lançar conta a pagar','Título em aberto'),
 ('ge','pagar_a_dre',2,'/dashboard/financeiro/pagar','Baixar o título','Título pago'),
 ('ge','pagar_a_dre',3,'/dashboard/financeiro/conciliacao','Conciliar com o extrato','Lançamento conciliado'),
 ('ge','pagar_a_dre',4,'/dashboard/dre','Conferir DRE','Despesa do mês bate com o pago')
ON CONFLICT DO NOTHING;
