-- COMPL-L3 (#18) · Treinamentos NR editável. Auditoria (RD-38/RD-51/RD-26): o CRUD JÁ EXISTE —
-- fn_nr_tipo_salvar/_excluir/_listar + a tela /dashboard/compliance/treinamentos (aba "Tipos de
-- Treinamento") com Incluir/Editar/Excluir(soft) e empty state amigável. A premissa "não há RPC de
-- CRUD" era falsa; NÃO criei fn_nr_treinamento_* (duplicaria). O único gap era a tabela VAZIA (0
-- linhas) → a tela abria "sem dados". Aqui só o SEED de conveniência do Frioeste com os NRs comuns
-- de frigorífico/indústria. A Karol edita/remove pela tela e preenche carga/validade legais.
--
-- carga_horaria/validade_meses/reciclagem_meses ficam NULL de propósito (RD-58: não invento valores
-- legais). obrigatorio=true como padrão do setor — a Karol ajusta. Idempotente por (company_id, nr_codigo).

INSERT INTO public.nr_treinamento_tipo (company_id, nr_codigo, nome, obrigatorio, ativo)
SELECT '975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, v.nr_codigo, v.nome, true, true
FROM (VALUES
  ('NR-1',  'Disposições Gerais e Gerenciamento de Riscos Ocupacionais'),
  ('NR-5',  'CIPA — Comissão Interna de Prevenção de Acidentes'),
  ('NR-6',  'EPI — Equipamento de Proteção Individual'),
  ('NR-10', 'Segurança em Instalações e Serviços em Eletricidade'),
  ('NR-11', 'Transporte, Movimentação, Armazenagem e Manuseio de Materiais'),
  ('NR-12', 'Segurança no Trabalho em Máquinas e Equipamentos'),
  ('NR-33', 'Segurança e Saúde em Espaços Confinados'),
  ('NR-35', 'Trabalho em Altura'),
  ('NR-36', 'Trabalho em Frigoríficos — Abate e Processamento de Carnes')
) AS v(nr_codigo, nome)
WHERE NOT EXISTS (
  SELECT 1 FROM public.nr_treinamento_tipo x
  WHERE x.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid AND x.nr_codigo = v.nr_codigo
);
