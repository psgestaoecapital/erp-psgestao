-- ============================================================
-- P&M D0 · catálogo PADRÃO de 10 papéis da AGÊNCIA (vertical 'pm') — Decisão CEO 06/10
-- Aditivo: só INSERT idempotente em rbac_papel / rbac_papel_acesso (nenhuma linha existente é alterada).
-- Padrão da vertical, NÃO por empresa: serve a toda agência que contratar a área P&M.
-- Subgrupos (vocabulário de acesso da vertical): pm_comercial · pm_producao · pm_financeiro · pm_inteligencia
-- (as 4 seções do menu P&M) + pm_midia (PI/veículos/CENP) + pm_portal (aprovação do cliente) +
-- ge_financeiro (Gestão Empresarial: faturamento, receber/pagar, comissões).
-- Regras do CEO: salário/custo-hora só com direito próprio (#2031) — NENHUM papel recebe 'folha'/'custo_hora'
-- aqui; quem cadastra não aprova a própria proposta/comissão (nível 'aprovar' só em quem NÃO é o cadastrador:
-- comercial fica em 'editar'; a aprovação é do gestor/sócio).
-- Camadas seguem o CHECK existente (propriedade/direcao/gerencia/supervisao/especialista/operacao).
-- ============================================================

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, pode_liberar_ate, exige_registro) VALUES
 ('pm_socio','pm','propriedade',NULL,'Sócio / Diretor da agência',
  'Tudo da agência: carteira, fees, jobs, pauta, financeiro, comissões, margens e equipe.','qualquer',false),
 ('pm_gestor_contas','pm','gerencia','atendimento','Gestor de contas / responsável do fee',
  'Carteira, fees, jobs, pauta, aprovações e margem por job. Sem folha de pagamento.','supervisao',false),
 ('pm_atendimento','pm','especialista','atendimento','Atendimento',
  'Carteira, abre job, briefing, pauta e aprovação do cliente. Sem margens nem custos.',NULL,false),
 ('pm_comercial','pm','especialista','comercial','Comercial',
  'Leads, propostas, novos contratos e a PRÓPRIA comissão. Sem produção detalhada nem financeiro geral.',NULL,false),
 ('pm_dir_criacao','pm','direcao','criacao','Diretor de Criação / Coordenador de produção',
  'Pauta inteira, distribui jobs e prazos, carga da equipe e Painel de Jobs. Sem financeiro.','operacao',false),
 ('pm_producao','pm','operacao','criacao','Produção (designer, redator, social media, vídeo, tráfego)',
  'Meu dia, Meus Trabalhos, jobs atribuídos e lançamento de horas. Sem valores, margens nem clientes fora dos seus jobs.',NULL,false),
 ('pm_midia','pm','especialista','midia','Mídia',
  'PIs, veículos, veiculações e CENP. Sem financeiro geral nem folha.',NULL,false),
 ('pm_financeiro','pm','gerencia','financeiro','Financeiro (GE)',
  'Faturamento, contas a receber/pagar e comissões a pagar. Sem detalhe de produção.','supervisao',false),
 ('pm_terceiro','pm','operacao','criacao','Terceiro / Freelancer',
  'Somente os jobs atribuídos a ele.',NULL,false),
 ('pm_cliente','pm','operacao','portal','Cliente (portal)',
  'Aprovações e pedidos da própria empresa, quando o portal existir.',NULL,false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
-- 1 Sócio: tudo
 ('pm_socio','pm_comercial','aprovar'),('pm_socio','pm_producao','aprovar'),('pm_socio','pm_financeiro','aprovar'),
 ('pm_socio','pm_inteligencia','aprovar'),('pm_socio','pm_midia','aprovar'),('pm_socio','pm_portal','aprovar'),
 ('pm_socio','ge_financeiro','aprovar'),
-- 2 Gestor de contas: carteira/fees/jobs/pauta/aprovações/margem por job; GE só leitura; sem folha
 ('pm_gestor_contas','pm_comercial','editar'),('pm_gestor_contas','pm_producao','aprovar'),
 ('pm_gestor_contas','pm_financeiro','ver'),('pm_gestor_contas','pm_inteligencia','ver'),
 ('pm_gestor_contas','pm_midia','ver'),('pm_gestor_contas','pm_portal','aprovar'),
 ('pm_gestor_contas','ge_financeiro','ver'),
-- 3 Atendimento: sem margens/custo (nada em pm_financeiro/pm_inteligencia/ge_financeiro)
 ('pm_atendimento','pm_comercial','ver'),('pm_atendimento','pm_producao','editar'),('pm_atendimento','pm_portal','editar'),
-- 4 Comercial: leads/propostas/contratos (não aprova a própria proposta); própria comissão via pm_financeiro 'filtrar'
 ('pm_comercial','pm_comercial','editar'),('pm_comercial','pm_financeiro','filtrar'),
-- 5 Diretor de Criação: pauta inteira + carga; sem financeiro
 ('pm_dir_criacao','pm_producao','aprovar'),('pm_dir_criacao','pm_inteligencia','ver'),('pm_dir_criacao','pm_portal','ver'),
-- 6 Produção: só o que é seu (filtrar = apenas os jobs atribuídos); sem valores
 ('pm_producao','pm_producao','filtrar'),
-- 7 Mídia
 ('pm_midia','pm_midia','editar'),('pm_midia','pm_producao','ver'),
-- 8 Financeiro GE: sem detalhe de produção
 ('pm_financeiro','ge_financeiro','aprovar'),('pm_financeiro','pm_financeiro','aprovar'),
-- 9 Terceiro: só jobs atribuídos
 ('pm_terceiro','pm_producao','filtrar'),
-- 10 Cliente/portal: só a própria empresa
 ('pm_cliente','pm_portal','filtrar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;

COMMENT ON TABLE public.rbac_papel IS
  'Catálogo de papéis por vertical (industria, pm). Padrão da vertical — não é por empresa.';
