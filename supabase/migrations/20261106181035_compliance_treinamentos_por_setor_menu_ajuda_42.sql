-- Chamado #42 (Frioeste) — Parametrização de treinamentos por setor.
-- A TELA e o BACKEND já existem e funcionam ponta a ponta:
--   fn_compliance_setor_exigencias_salvar -> compliance_exigencia_setor -> fn_compliance_pessoa_docs
--   (a aba Documentos do funcionário lê a mesma regra).
-- Gap que esta migration fecha (RD-98): a tela estava INVISÍVEL — fora do menu (module_catalog),
-- sem origem do dado (system_screens) e sem o "?" RD-95 nos campos. Nada aqui altera dado de cliente;
-- é 100% aditivo e idempotente. Sem RLS nova (tabelas já existentes e protegidas).

-- 1) "?" RD-95 (erp_ajuda_campo) — status 'publicado' para a fn_ajuda_campo_listar devolver na tela.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('compliance.treinamentos_por_setor.setor', '/dashboard/compliance/treinamentos-por-setor', 'Treinamentos por setor', 'Setor',
   'Escolha o setor cujos treinamentos/documentos obrigatórios você quer parametrizar.',
   'Define para QUAL grupo de colaboradores a regra vale: todo mundo lotado neste setor passa a ter os itens marcados como exigidos na aba Documentos.',
   'Produção, Manutenção, Administrativo.',
   'Trocar de setor sem salvar: o que você marcou no setor anterior só vale depois de clicar em Salvar naquele setor.',
   'compliance', 10, 1, 'publicado'),
  ('compliance.treinamentos_por_setor.exigencia', '/dashboard/compliance/treinamentos-por-setor', 'Treinamentos por setor', 'Treinamentos/documentos do setor',
   'Marque os treinamentos e documentos que TODOS os colaboradores deste setor precisam ter.',
   'O que for marcado é SOMADO ao que a empresa já exige por cargo ou para todos — marcar aqui nunca tira exigência de ninguém. Cada pessoa do setor passa a ter estes itens cobrados na aba Documentos.',
   'No setor Produção, marcar "NR-12", "NR-35" e "Integração de segurança".',
   'Esperar que desmarcar aqui remova um item que já é exigido por cargo: o rótulo verde "já exigido por este setor pela regra atual" indica itens que continuam valendo por outra regra.',
   'compliance', 20, 1, 'publicado'),
  ('compliance.treinamentos_por_setor.salvar', '/dashboard/compliance/treinamentos-por-setor', 'Treinamentos por setor', 'Salvar',
   'Grava a lista de exigências marcadas para o setor selecionado.',
   'Ao salvar, os colaboradores deste setor passam imediatamente a ter os treinamentos/documentos marcados na aba Documentos do funcionário (e no cálculo de conformidade).',
   'Marcar 3 itens e clicar em Salvar: a mensagem confirma que o setor passou a exigi-los.',
   'Sair da tela sem salvar: as marcações não persistem.',
   'compliance', 30, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 2) Menu (module_catalog) — tela aparece ao lado de "Documentos Exigidos" (mesmo subgrupo), para o usuário alcançá-la.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, is_shared)
SELECT 'compliance_treinamentos_por_setor', 'Treinamentos por Setor', 'compliance', 'docs_regulatorios', 'GraduationCap',
       '/dashboard/compliance/treinamentos-por-setor', 13, true,
       'Parametrize por setor os treinamentos/documentos exigidos de todos os colaboradores — somado ao que já é exigido por cargo.',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.module_catalog WHERE rota = '/dashboard/compliance/treinamentos-por-setor' OR id = 'compliance_treinamentos_por_setor'
);
-- Se já existir a linha (de carga anterior), apenas garante que está ativa e no menu certo.
UPDATE public.module_catalog
   SET ativo = true, grupo = 'compliance', subgrupo = 'docs_regulatorios'
 WHERE rota = '/dashboard/compliance/treinamentos-por-setor' AND (ativo IS DISTINCT FROM true);

-- 3) Origem do dado (system_screens) — RD-98 p3.
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real,
       prioridade_monitoramento, auditavel_robo, views_consumidas, rpcs_chamadas, componentes_principais)
VALUES ('dashboard.compliance_treinamentos_por_setor', '/dashboard/compliance/treinamentos-por-setor', 'compliance', 'Treinamentos por setor',
        'Parametriza, por setor, os treinamentos/documentos exigidos de todos os colaboradores do setor. É somado às regras por cargo/para-todos; alimenta a aba Documentos do funcionário.',
        'compliance', 'pronto', 'media', true,
        ARRAY['compliance_funcionarios','compliance_documento_exigido','compliance_exigencia_setor']::text[],
        ARRAY['fn_compliance_cargos_setores','fn_compliance_setor_exigencias_listar','fn_compliance_setor_exigencias_salvar','fn_compliance_pessoa_docs']::text[],
        ARRAY['TreinamentosPorSetorPage']::text[])
ON CONFLICT (rota) DO UPDATE SET
  area = EXCLUDED.area,
  titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional,
  modulo = EXCLUDED.modulo,
  estado_real = EXCLUDED.estado_real,
  views_consumidas = EXCLUDED.views_consumidas,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  componentes_principais = EXCLUDED.componentes_principais,
  atualizado_em = now();
