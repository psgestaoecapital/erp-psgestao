-- Blueprint vivo: requisitos da área "Gestão de Obras" (simplificada)
-- Público: arquitetos, engenheiros autônomos, empreiteiras e pequenas construtoras.
-- Decisões CEO 30/10 e 01/11 — área própria dentro do Hub, vendida em plano separado,
-- que REUSA o que já existe/está em construção (obra, cronograma, diário, medição/avanço,
-- custos e previsto×realizado, portal do cliente, frota opcional) — nada duplicado.
-- Registro de requisitos ANTES das PRs de tela (aviso eng_chefe 01/11).
-- RD-100: nenhum nome de outro sistema nos requisitos.
-- Aditivo e idempotente: apenas INSERT com ON CONFLICT na chave (vertical, tela_num, requisito).

INSERT INTO blueprint_tela_requisito (vertical, tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline)
VALUES
  -- 300 · Menu e plano próprios (liberam só as telas da área)
  ('hub_projetos', 300, 'Gestão de Obras — Menu e plano próprios', NULL,
   'Item de menu "Gestão de Obras" e plano/tier que libera somente as telas desta área; o acesso é controlado no banco (gating + RLS por empresa), sem preço embutido (preço é decisão do CEO).', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 300, 'Gestão de Obras — Menu e plano próprios', NULL,
   'Quem não tem o plano da área não enxerga nem acessa as telas de Gestão de Obras (guarda no banco, não só no front).', 'guard', 'essencial', 'ausente'),

  -- 301 · Obra rápida (uma tela)
  ('hub_projetos', 301, 'Gestão de Obras — Obra rápida', NULL,
   'Criar uma obra em uma única tela: cliente, endereço, valor previsto, prazo (início e previsão de término) e itens simples; a obra fica pronta ao salvar.', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 301, 'Gestão de Obras — Obra rápida', NULL,
   'Campos obrigatórios mínimos (cliente, endereço, valor, prazo) com "?" explicativo em cada um; itens simples opcionais no mesmo formulário.', 'campo', 'essencial', 'ausente'),

  -- 302 · Cronograma sugerido automaticamente
  ('hub_projetos', 302, 'Gestão de Obras — Cronograma sugerido', NULL,
   'Ao salvar a obra rápida, o sistema sugere automaticamente um cronograma inicial a partir do prazo e dos itens informados; o usuário pode ajustar depois.', 'regra', 'essencial', 'ausente'),

  -- 303 · Diário de obra com fotos
  ('hub_projetos', 303, 'Gestão de Obras — Diário de obra com fotos', NULL,
   'Registro diário da obra (RDO) com anexo de fotos, reusando a estrutura de diário já existente no Hub; mobile-first para uso no canteiro.', 'tela', 'essencial', 'ausente'),

  -- 304 · Medição / avanço por item
  ('hub_projetos', 304, 'Gestão de Obras — Medição e avanço por item', NULL,
   'Lançamento de medição/avanço por item da obra, alimentando o avanço físico e financeiro; reusa a cadeia de medição já existente.', 'regra', 'essencial', 'ausente'),

  -- 305 · Custos em lançamento simples (centro de custo = obra)
  ('hub_projetos', 305, 'Gestão de Obras — Custos simples da obra', NULL,
   'Lançamento simples de custos da obra em três categorias (material, mão de obra, terceiros) na estrutura financeira existente (contas a pagar) com centro de custo = obra, sem exigir o financeiro completo.', 'tela', 'essencial', 'ausente'),

  -- 306 · Previsto × realizado
  ('hub_projetos', 306, 'Gestão de Obras — Previsto × realizado', NULL,
   'Comparação previsto × realizado da obra (valor e avanço) reutilizando o resultado por obra já existente; destaque quando o realizado ultrapassa o previsto.', 'kpi', 'essencial', 'ausente'),

  -- 307 · Portal do cliente (só leitura + aprovação de revisão)
  ('hub_projetos', 307, 'Gestão de Obras — Portal do cliente', NULL,
   'Portal do cliente da obra (acesso por convite, restrito por RLS à(s) obra(s) do cliente): ver avanço/cronograma, fotos do diário, medições e títulos; aprovar revisão de escopo. V1 só leitura + aprovação, nunca link público sem autenticação.', 'tela', 'essencial', 'ausente'),
  ('hub_projetos', 307, 'Gestão de Obras — Portal do cliente', NULL,
   'Isolamento comprovado: um cliente nunca enxerga obra de outra empresa nem de outra obra (RLS por empresa e por obra; acesso externo é sensível/LGPD).', 'guard', 'essencial', 'ausente'),

  -- 308 · Relatório ao cliente em PDF
  ('hub_projetos', 308, 'Gestão de Obras — Relatório ao cliente (PDF)', NULL,
   'Relatório da obra para o cliente em PDF: avanço, fotos do diário, custos e medições, em linguagem de arquiteto/engenheiro.', 'tela', 'essencial', 'ausente'),

  -- 309 · Frota (opcional)
  ('hub_projetos', 309, 'Gestão de Obras — Frota (opcional)', NULL,
   'Vínculo opcional de frota à obra (veículos/equipamentos alocados), habilitável por quem usa frota, sem obrigar quem não usa.', 'bloco', 'diferencial', 'ausente')
ON CONFLICT (vertical, tela_num, requisito) DO NOTHING;
