-- META CEO 02/11 — Área "Gestão de Obras" (plano próprio) dentro do Hub de Projetos.
-- Antes da primeira PR de tela (decisão do Eng. Chefe 01/11), os requisitos da área ficam
-- registrados no BLUEPRINT VIVO (blueprint_tela_requisito, vertical hub_projetos), para o
-- auditor e os Codes seguirem a mesma fonte. A área REUSA o que já existe/está em construção
-- (obra, cronograma/Gantt, diário/RDO, medição/avanço, custos e previsto×realizado, portal do
-- cliente, frota opcional) — nada aqui recria tela existente.
-- RD-100: linguagem de arquiteto/engenheiro autônomo/empreiteira, SEM nome de terceiros.
-- Aditiva e idempotente (guarda NOT EXISTS pela chave natural vertical+tela_num+requisito).
-- Code: dev7claudeps

INSERT INTO public.blueprint_tela_requisito
  (vertical, tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline)
SELECT v.vertical, v.tela_num, v.tela_nome, v.rota_padrao, v.requisito, v.tipo, v.prioridade, v.status_baseline
FROM (VALUES
  ('hub_projetos', 290, 'PS · Gestão de Obras · Menu e plano próprios', '/dashboard/projetos',
   'Menu "Gestão de Obras" em module_catalog e plano/tier que libera SÓ as telas desta área (gating no banco + RLS por empresa; preço é decisão do CEO, fora do requisito).',
   'regra', 'essencial', 'ausente'),
  ('hub_projetos', 290, 'PS · Gestão de Obras · Menu e plano próprios', '/dashboard/projetos',
   'Acesso restrito por plano: empresa sem o plano da área não enxerga as telas nem as rotas (guarda no banco, não só no front).',
   'guard', 'essencial', 'ausente'),
  ('hub_projetos', 291, 'PS · Gestão de Obras · Obra rápida (uma tela)', '/dashboard/projetos/obras',
   'Cadastrar uma obra em UMA tela: cliente, endereço, valor, prazo e itens simples — obra pronta ao salvar, sem exigir o fluxo completo de orçamento.',
   'tela', 'essencial', 'ausente'),
  ('hub_projetos', 291, 'PS · Gestão de Obras · Obra rápida (uma tela)', '/dashboard/projetos/obras',
   'Ao salvar a obra rápida, sugerir automaticamente um cronograma inicial a partir dos itens informados (reusa o cronograma/Gantt existente).',
   'regra', 'essencial', 'ausente'),
  ('hub_projetos', 292, 'PS · Gestão de Obras · Diário de obra com fotos', '/dashboard/projetos/obras',
   'Diário de obra com registro de fotos por dia (reusa o RDO/diário existente); cada foto com data e autor, exclusão rastreável.',
   'bloco', 'essencial', 'ausente'),
  ('hub_projetos', 293, 'PS · Gestão de Obras · Medição e avanço por item', '/dashboard/projetos/obras',
   'Medição/avanço por item da obra (percentual executado por item), reaproveitando a medição/avanço existente; base para o previsto×realizado.',
   'bloco', 'essencial', 'ausente'),
  ('hub_projetos', 294, 'PS · Gestão de Obras · Custos em lançamento simples', '/dashboard/projetos/obras',
   'Lançamento simples de custos da obra (material, mão de obra, terceiros) na estrutura existente (erp_pagar / centro de custo = obra), sem exigir o financeiro completo. Fronteira: compra e estoque continuam da GE.',
   'bloco', 'essencial', 'ausente'),
  ('hub_projetos', 295, 'PS · Gestão de Obras · Previsto × realizado', '/dashboard/projetos/obras',
   'Painel previsto × realizado da obra (valor e avanço), a partir da medição e dos custos lançados.',
   'kpi', 'essencial', 'ausente'),
  ('hub_projetos', 296, 'PS · Gestão de Obras · Portal do cliente da obra', '/dashboard/projetos/portal',
   'Portal do cliente (só leitura + aprovação de revisão): o cliente da obra vê avanço/cronograma, fotos do diário, medições e títulos, e aprova revisão de escopo. Acesso por convite, papel cliente_obra restrito por RLS à(s) obra(s) dele — nunca link público sem autenticação.',
   'tela', 'essencial', 'ausente'),
  ('hub_projetos', 296, 'PS · Gestão de Obras · Portal do cliente da obra', '/dashboard/projetos/portal',
   'LGPD/segurança: um cliente nunca enxerga obra de outro cliente nem de outra empresa (RLS por obra e por empresa, provado em teste).',
   'guard', 'essencial', 'ausente'),
  ('hub_projetos', 297, 'PS · Gestão de Obras · Relatório ao cliente (PDF)', '/dashboard/projetos/obras',
   'Relatório ao cliente em PDF: avanço, fotos do diário, custos e medições, em linguagem de arquiteto/engenheiro. Zero API paga.',
   'bloco', 'diferencial', 'ausente'),
  ('hub_projetos', 298, 'PS · Gestão de Obras · Frota (opcional)', '/dashboard/projetos/obras',
   'Frota opcional vinculada à obra (veículos/equipamentos), reaproveitando o módulo de frota existente; habilitável por empresa.',
   'bloco', 'diferencial', 'ausente')
) AS v(vertical, tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline)
WHERE NOT EXISTS (
  SELECT 1 FROM public.blueprint_tela_requisito b
  WHERE b.vertical = v.vertical AND b.tela_num = v.tela_num AND b.requisito = v.requisito
);
