-- /dashboard/projetos/obras/[id]/rdo — RD-95: "?" na ação "Editar" do histórico de diários
--
-- Contexto (auditor PDCA auditor_pdca_1, 06/11): a tela de Diário de Obra (RDO) tem "?" em
-- todos os campos/filtros/ações, MENOS no botão "Editar" do histórico (page.tsx l.271) —
-- enquanto o "Excluir" ao lado já tem (projetos.obra_rdo.excluir). RD-95 exige "?" em TODA
-- ação. Padrão já seguido na tela de Custos (projetos.obra_custos.editar).
--
-- Aditiva e idempotente: só acrescenta a chave de ajuda projetos.obra_rdo.editar em
-- erp_ajuda_campo (catálogo global de ajuda, sem company_id, sem dado de cliente, sem
-- RLS/policy/grant). ON CONFLICT (chave) DO NOTHING.

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.obra_rdo.editar', '/dashboard/projetos/obras/[id]/rdo', 'Diário de Obra', 'Editar diário',
  'Abre o diário já lançado para corrigir clima, efetivo, atividades, ocorrências, quantidade executada ou fotos. Salvar grava a alteração na hora (um diário por OS e dia).',
  'Ajustar um diário com informação errada ou incompleta sem precisar excluir e lançar de novo — a correção fica registrada (quem/quando).',
  'Lançou o efetivo como 8 mas eram 10 → Editar → efetivo 10 → Salvar.',
  'Não achar o "Editar" num diário antigo: só aparece enquanto a OS está aberta/em execução — OS concluída não permite editar o diário por aqui.',
  'hub_projetos', 6, 'publicado')
ON CONFLICT (chave) DO NOTHING;
