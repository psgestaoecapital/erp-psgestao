-- PDCA · mapa de LIGAÇÕES entre telas (CEO 09/10): origem, ação, destino, o que tem de aparecer, consulta de conferência.
-- Aditiva: 2 tabelas NOVAS, RLS ligada, sem policy para usuário (só service_role/rotinas), REVOKE de anon/authenticated.
-- Code: gilberto-chamados

CREATE TABLE IF NOT EXISTS public.pdca_ligacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical text NOT NULL,
  codigo text NOT NULL,
  rota_origem text NOT NULL,
  acao text NOT NULL,
  rota_destino text NOT NULL,
  deve_aparecer text NOT NULL,
  sql_confere text,                   -- SELECT (1 linha, 1 número); sem DML
  empresa_demo_id uuid,
  code_dono text,                     -- identificador da caixa que recebe a tarefa se ficar vermelha
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, codigo),
  CHECK (sql_confere IS NULL OR sql_confere ~* '^\s*select\M')
);

CREATE TABLE IF NOT EXISTS public.pdca_ligacao_resultado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ligacao_id uuid NOT NULL REFERENCES public.pdca_ligacao(id) ON DELETE CASCADE,
  ciclo_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('verde','vermelha','nao_executada')),
  diagnostico text,                   -- "o que falta desenvolver" quando vermelha
  prova jsonb NOT NULL DEFAULT '{}'::jsonb,
  mensagem_agente_id uuid,            -- tarefa automática aberta ao Code dono (sem duplicar)
  executado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ligacao_id, ciclo_ref)
);

ALTER TABLE public.pdca_ligacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdca_ligacao_resultado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pdca_ligacao, public.pdca_ligacao_resultado FROM anon, authenticated;

-- Primeiras ligações: Hub (oportunidade ganha → obra) e GE (baixa → conciliação). Consultas finas vêm com o executor.
INSERT INTO public.pdca_ligacao (vertical, codigo, rota_origem, acao, rota_destino, deve_aparecer, empresa_demo_id, code_dono) VALUES
  ('hub','hub-ganha-abre-obra','/dashboard/projetos/oportunidades','marcar oportunidade como ganha','/dashboard/projetos/obras','a obra criada aparece na lista com cliente e valor da proposta','b0700000-0000-4000-a000-000000000006','gilberto-chamados'),
  ('hub','hub-obra-resultado','/dashboard/projetos/obras','abrir a obra','/dashboard/projetos/resultado','compras, viagens e medições da obra somam no resultado por obra','b0700000-0000-4000-a000-000000000006','gilberto-chamados'),
  ('ge','ge-baixa-concilia','/dashboard/financeiro','baixar lançamento a pagar','/dashboard/conciliacao','o lançamento baixado aparece para conciliar e reflete no DRE',NULL,'gilberto-desenv')
ON CONFLICT (vertical, codigo) DO NOTHING;
