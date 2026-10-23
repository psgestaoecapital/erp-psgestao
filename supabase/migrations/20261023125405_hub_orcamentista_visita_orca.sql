-- Chamados #3268 e #3270/#3271 (Tryo, HB2): visita feita leva a oportunidade para "Orçando" e orçamentista no orçamento.
-- RD-97: ADITIVA e opt-in. Colunas novas com padrão FALSE/NULL: empresa sem configuração não muda nada.
-- Plano de volta: desligar o flag (visita_feita_vai_orcar=false) devolve o comportamento anterior; DROP TRIGGER/COLUMN seguro, ninguém mais lê.

ALTER TABLE public.orcamento_config_empresa
  ADD COLUMN IF NOT EXISTS visita_feita_vai_orcar boolean NOT NULL DEFAULT false;
-- A linha da config exigia validade_dias; passa a ser opcional para quem só liga o fluxo da visita.
ALTER TABLE public.orcamento_config_empresa ALTER COLUMN validade_dias DROP NOT NULL;

ALTER TABLE public.erp_orcamentos
  ADD COLUMN IF NOT EXISTS orcamentista_id uuid,
  ADD COLUMN IF NOT EXISTS orcamentista_nome text;
CREATE INDEX IF NOT EXISTS idx_erp_orcamentos_orcamentista ON public.erp_orcamentos (company_id, orcamentista_id) WHERE orcamentista_id IS NOT NULL;

-- #3268: visita realizada em oportunidade de empresa que ligou o flag vai direto para a fila do orçamento ('orcando').
CREATE OR REPLACE FUNCTION public.tg_crm_oport_visita_vai_orcar()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.etapa = 'visita_feita' AND OLD.etapa IN ('prospeccao','visita_agendada')
     AND EXISTS (SELECT 1 FROM orcamento_config_empresa c WHERE c.company_id = NEW.company_id AND c.visita_feita_vai_orcar)
     AND EXISTS (SELECT 1 FROM erp_crm_visita v WHERE v.oportunidade_id = NEW.id AND v.status = 'realizada') THEN
    NEW.etapa := 'orcando';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_crm_oport_visita_vai_orcar ON public.erp_crm_oportunidade;
CREATE TRIGGER trg_crm_oport_visita_vai_orcar BEFORE UPDATE OF etapa ON public.erp_crm_oportunidade
  FOR EACH ROW WHEN (NEW.etapa IS DISTINCT FROM OLD.etapa) EXECUTE FUNCTION public.tg_crm_oport_visita_vai_orcar();

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('orcamentos.config.visita_vai_orcar', '/dashboard/orcamentos', 'Orçamento', 'Visita feita vai para Orçando',
  'Marque para que, ao registrar a visita como realizada, a oportunidade vá direto para a etapa Orçando.',
  'Evita mover o cartão à mão: quem faz a visita já deixa a oportunidade na fila de quem elabora o orçamento.',
  'Visita realizada em 20/10 → a oportunidade aparece em Orçando.',
  'Esperar que mude oportunidades que já estão em outra etapa: só vale quando a visita é registrada como realizada.',
  'gestao_empresarial', 'publicado'),
 ('orcamentos.filtro.meus', '/dashboard/orcamentos', 'Orçamento', 'Filtro Meus (orçamentista)',
  'Clique para ver só os orçamentos em que você é o orçamentista.',
  'Mostra sua fila de trabalho sem as dos colegas.',
  'Com Meus ligado, só aparecem os orçamentos atribuídos a você.',
  'Achar que o filtro apaga orçamentos: ele só esconde os dos outros até desligar.',
  'gestao_empresarial', 'publicado'),
 ('orcamentos.campo.orcamentista', '/dashboard/orcamentos', 'Orçamento', 'Orçamentista',
  'Escolha quem vai elaborar este orçamento.',
  'Ao atribuir um orçamentista a um rascunho, ele passa a aparecer como Em elaboração.',
  'Atribuir a Maria → o orçamento aparece como Em elaboração, com Maria na coluna Orçamentista.',
  'Atribuir a quem não é da empresa: só aparecem usuários da empresa do orçamento.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
