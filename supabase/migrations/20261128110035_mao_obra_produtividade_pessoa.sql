-- Mão de obra FASE 1 (CEO 26/11): produtividade POR PESSOA + conversão automática.
-- Separa "quanto se produz" (técnico) de "como se paga" (comercial). Aditiva (RD-97):
-- novas colunas em projetos_servicos; o produtividade_unidade_dia (equipe/dia) legado continua
-- funcionando (não-regressão). Sem função nova — a tela grava projetos_servicos por update (dono).
-- RD-52: arquivo + PR; nunca apply_migration.

ALTER TABLE public.projetos_servicos
  ADD COLUMN IF NOT EXISTS produtividade_pessoa numeric(14,4),              -- quanto 1 PESSOA produz (na unidade do serviço)
  ADD COLUMN IF NOT EXISTS produtividade_base text NOT NULL DEFAULT 'dia',  -- a produtividade por pessoa é por 'hora' ou por 'dia'
  ADD COLUMN IF NOT EXISTS jornada_horas_dia numeric(5,2) NOT NULL DEFAULT 8, -- jornada (h/dia) p/ converter dia<->hora
  ADD COLUMN IF NOT EXISTS equipe_pessoas numeric(8,2);                      -- nº de pessoas padrão (equipe_padrao segue como texto)

ALTER TABLE public.projetos_servicos DROP CONSTRAINT IF EXISTS projetos_servicos_produtividade_base_check;
ALTER TABLE public.projetos_servicos ADD CONSTRAINT projetos_servicos_produtividade_base_check
  CHECK (produtividade_base IN ('hora','dia'));
ALTER TABLE public.projetos_servicos DROP CONSTRAINT IF EXISTS projetos_servicos_jornada_check;
ALTER TABLE public.projetos_servicos ADD CONSTRAINT projetos_servicos_jornada_check
  CHECK (jornada_horas_dia > 0 AND jornada_horas_dia <= 24);

-- Ajuda RD-95 dos campos novos (idempotente)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('projetos.catalogo.servico.produtividade_pessoa', '/dashboard/projetos/catalogo/[id]', 'Produtividade', 'Produção por pessoa',
   'Quanto UMA pessoa produz, na unidade do serviço (m², m, un, kg…), por hora ou por dia (você escolhe ao lado).',
   'É o parâmetro técnico do serviço. O sistema multiplica pelo nº de pessoas para achar a produção da equipe e calcular o custo por unidade — você não precisa pensar em "horas por m²".',
   '3 m²/pessoa/hora (assentamento); 1 pessoa faz 24 m² por dia.',
   'Informar a produção da EQUIPE aqui — este campo é por PESSOA; o nº de pessoas é o campo ao lado.', 'projetos', 40),
  ('projetos.catalogo.servico.produtividade_base', '/dashboard/projetos/catalogo/[id]', 'Produtividade', 'Por hora ou por dia',
   'Se a produção por pessoa que você informou é POR HORA ou POR DIA.',
   'Deixa você pensar do jeito que é natural; o sistema converte usando a jornada (h/dia).',
   'Por dia, se você sabe "1 pessoa faz 24 m²/dia"; por hora, se pensa "3 m²/h".',
   'Marcar por hora mas digitar o número do dia (ou o contrário).', 'projetos', 41),
  ('projetos.catalogo.servico.jornada_horas_dia', '/dashboard/projetos/catalogo/[id]', 'Produtividade', 'Jornada (horas/dia)',
   'Quantas horas a equipe trabalha por dia (padrão 8).',
   'Converte a produção entre dia e hora e estima prazo. Ajuste se a jornada da sua equipe for diferente.',
   '8 (padrão); 9 com hora extra fixa.',
   'Confundir jornada com dias úteis do mês.', 'projetos', 42),
  ('projetos.catalogo.servico.equipe_pessoas', '/dashboard/projetos/catalogo/[id]', 'Produtividade', 'Nº de pessoas na equipe',
   'Quantas pessoas, em média, fazem este serviço.',
   'O sistema multiplica pela produção por pessoa para achar a produção da equipe (e o custo por unidade). Mudar aqui recalcula sozinho.',
   '8 pessoas; 1 montador + 1 servente = 2.',
   'Deixar vazio num serviço por equipe própria/hora — sem o nº de pessoas o custo por unidade não fecha.', 'projetos', 43)
ON CONFLICT (chave) DO NOTHING;
