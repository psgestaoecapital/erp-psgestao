-- PDCA automático de qualidade · fatia P (CEO 09/10): jornadas por vertical + banco de sugestões/inovações.
-- Aditiva: 3 tabelas NOVAS, RLS ligada, sem policy para usuário (só service_role/rotinas), REVOKE de anon/authenticated.
-- Code: gilberto-chamados

CREATE TABLE IF NOT EXISTS public.pdca_jornada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical text NOT NULL,
  codigo text NOT NULL,
  nome text NOT NULL,
  empresa_demo_id uuid,               -- empresa DEMO onde o robô executa
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, codigo)
);

CREATE TABLE IF NOT EXISTS public.pdca_jornada_passo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jornada_id uuid NOT NULL REFERENCES public.pdca_jornada(id) ON DELETE CASCADE,
  ordem int NOT NULL,
  passo text NOT NULL,
  rota text,
  acao text,
  deve_aparecer text,
  sql_confere text,                   -- consulta SELECT (1 linha, 1 número) que tem de bater; sem DML
  regras text[] NOT NULL DEFAULT '{}',
  UNIQUE (jornada_id, ordem),
  CHECK (sql_confere IS NULL OR sql_confere ~* '^\s*select\M')
);

CREATE TABLE IF NOT EXISTS public.pdca_sugestao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical text NOT NULL,
  rota text,
  eixo text NOT NULL CHECK (eixo IN ('facilidade','produtividade','custo','vantagem')),
  titulo text NOT NULL,
  descricao text,
  impacto_estimado text,
  blueprint_secao text,               -- proposta de mudança no blueprint: seção
  blueprint_texto_sugerido text,      -- texto sugerido
  status text NOT NULL DEFAULT 'sugerida' CHECK (status IN ('sugerida','aprovada','recusada','virou_onda')),
  ciclo_ref text,
  chave_dedup text NOT NULL,
  decidido_por text,
  decidido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, chave_dedup)
);

ALTER TABLE public.pdca_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdca_jornada_passo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdca_sugestao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pdca_jornada, public.pdca_jornada_passo, public.pdca_sugestao FROM anon, authenticated;

-- Primeiras jornadas: Hub e GE (passos; o robô e as consultas finas vêm nas próximas fatias)
INSERT INTO public.pdca_jornada (vertical, codigo, nome, empresa_demo_id) VALUES
  ('hub','hub-cliente-ate-resultado','Cliente → oportunidade → proposta → ganha → obra → compra → resultado','b0700000-0000-4000-a000-000000000006'),
  ('ge','ge-pagar-ate-dre','Lançar a pagar → baixar → conciliar → DRE',NULL)
ON CONFLICT (vertical, codigo) DO NOTHING;

INSERT INTO public.pdca_jornada_passo (jornada_id, ordem, passo, rota, acao, deve_aparecer)
SELECT j.id, p.ordem, p.passo, p.rota, p.acao, p.deve
FROM public.pdca_jornada j
JOIN (VALUES
  ('hub-cliente-ate-resultado',1,'Cadastrar cliente','/dashboard/projetos/clientes','salvar cliente','cliente na lista'),
  ('hub-cliente-ate-resultado',2,'Criar oportunidade','/dashboard/projetos/oportunidades','salvar oportunidade','card no funil'),
  ('hub-cliente-ate-resultado',3,'Gerar proposta com itens','/dashboard/projetos/propostas','salvar proposta','proposta com total'),
  ('hub-cliente-ate-resultado',4,'Marcar ganha e abrir obra','/dashboard/projetos/oportunidades','marcar ganha','obra criada'),
  ('hub-cliente-ate-resultado',5,'Lançar compra da obra','/dashboard/projetos/obras','lançar compra','compra somada ao custo'),
  ('hub-cliente-ate-resultado',6,'Ver resultado da obra','/dashboard/projetos/resultado','abrir resultado','receita, custo e margem batendo'),
  ('ge-pagar-ate-dre',1,'Lançar conta a pagar','/dashboard/financeiro/pagar','salvar lançamento','título em aberto'),
  ('ge-pagar-ate-dre',2,'Baixar o título','/dashboard/financeiro/pagar','baixar','título pago'),
  ('ge-pagar-ate-dre',3,'Conciliar com o extrato','/dashboard/financeiro/conciliacao','conciliar','item conciliado'),
  ('ge-pagar-ate-dre',4,'Conferir na DRE','/dashboard/financeiro/dre','abrir DRE','despesa refletida no período')
) AS p(cod,ordem,passo,rota,acao,deve) ON j.codigo = p.cod
ON CONFLICT (jornada_id, ordem) DO NOTHING;
