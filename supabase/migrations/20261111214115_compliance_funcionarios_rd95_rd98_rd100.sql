-- Compliance · Funcionários (/dashboard/compliance/funcionarios) — aud8 68/95.
-- Gaps de código fechados no mesmo PR (front, aditivo):
--   RD-95 "?": AjudaCampo nos filtros (Buscar/Tomadora/Vínculo/Cargo/Setor/Status),
--     na coluna indicadora Compliance %, na coluna Ações e nas ações Importar/Novo;
--   RD-100: o rótulo visível "IO Point" (botão, confirmação e tooltip de importação) virou
--     "ponto eletrônico" (nome genérico) — o identificador técnico (tabela ind_ponto_colaborador
--     e a RPC) não é visível ao usuário e segue inalterado;
--   RD-98 p3 (ESTA migration): origem do dado em system_screens.
-- PENDENTE (fora deste PR, exige decisão do eng_chefe — LGPD/NR retenção): RD-98 p2 "Excluir".
--   Não existe RPC guardada de desligar/excluir funcionário de compliance (só dispensar DOCUMENTO
--   via fn_compliance_pessoa_dispensar). Expor exclusão de pessoa é decisão sensível (soft-delete +
--   audit + retenção NR/LGPD) — não inventada aqui (RD-38).
-- ADITIVA/idempotente, NÃO altera dado de cliente, RLS/grant/RPC. Faixa dev7claudeps (segundos :15), acima da main.

-- ── (1) RD-95: chaves de ajuda dos filtros/colunas/ações ──────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compliance/funcionarios', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.funcionarios.busca','Filtros','Buscar','Digite nome, CPF ou matrícula para filtrar a lista.','Encontra rápido um funcionário sem rolar toda a lista.','Digite "Maria" ou um CPF para ir direto à pessoa.','A busca é por nome/CPF/matrícula — não procura por cargo nem setor (use os filtros ao lado).',1),
 ('compliance.funcionarios.filtro_tomadora','Filtros','Tomadora','Empresa tomadora do serviço (onde o funcionário atua).','Filtra a lista pela empresa que recebe o serviço — útil quando há terceirizados em várias obras/tomadoras.','Selecione "Obra Centro" para ver só quem atua lá.','Mostra só as tomadoras presentes na lista atual.',2),
 ('compliance.funcionarios.filtro_vinculo','Filtros','Vínculo','Tipo de vínculo: direto (da empresa) ou terceirizado (de prestador).','Separa o quadro próprio dos terceirizados — cada um tem documentos de compliance diferentes.','Selecione "Terceirizados" para conferir a documentação dos prestadores.','—',3),
 ('compliance.funcionarios.filtro_cargo','Filtros','Cargo','Função exercida pelo funcionário.','Filtra por cargo para conferir exigências específicas (ex.: NR por função).','Selecione "Soldador" para ver só esse cargo.','A lista traz só os cargos que existem no resultado atual.',4),
 ('compliance.funcionarios.filtro_setor','Filtros','Setor','Setor/área onde o funcionário trabalha.','Filtra por setor para organizar a conferência por área.','Selecione "Produção" para ver só esse setor.','—',5),
 ('compliance.funcionarios.filtro_status','Filtros','Status de compliance','Situação da documentação: 100% em dia, com pendências, ou 0% em dia.','Vai direto a quem precisa de ação — priorize "0% em dia" e "Pendências".','Selecione "Pendências" para ver quem tem documento faltando.','É calculado sobre os documentos exigidos de cada pessoa.',6),
 ('compliance.funcionarios.col_compliance','Indicadores','Compliance %','Percentual de documentos obrigatórios em dia para a pessoa.','Mostra, numa barra, quão completa está a documentação de cada funcionário.','"80% · 4/5 em dia" = falta 1 documento.','0% não significa sem documento exigido — significa que nenhum dos exigidos está em dia.',7),
 ('compliance.funcionarios.col_acoes','Ações','Ações','Ações disponíveis na linha do funcionário.','"Abrir" leva à ficha completa (documentos, ASO, dados cadastrais) para incluir/editar.','Clique em "Abrir" para gerenciar a documentação da pessoa.','—',8),
 ('compliance.funcionarios.acao_importar_ponto','Ações','Importar do ponto eletrônico','Traz os colaboradores do sistema de ponto para a ficha de compliance (só completa campos vazios).','Evita recadastrar todo mundo à mão — puxa quem já está no ponto e preserva o que foi preenchido manualmente.','Clique para importar; o que foi digitado à mão (RG, endereço, salário, ASO) não é sobrescrito.','Só aparece com UMA empresa selecionada; quem não tem CPF no ponto é ignorado.',9),
 ('compliance.funcionarios.acao_novo','Ações','Novo funcionário','Cadastra um funcionário manualmente na ficha de compliance.','Para incluir quem não vem do ponto eletrônico (ex.: terceirizado novo).','Clique em "+ Novo funcionário" e preencha nome, CPF, cargo e vínculo.','—',10)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ── (2) RD-98 p3: origem do dado da tela ──────────────────────────────────────────────────────────────────────────
-- A lista computa o % de documentos em dia pela view v_compliance_matriz_funcionarios; a importação usa
-- fn_compliance_projetar_de_ind_ponto; o salário individual (LGPD) só sai por fn_compliance_funcionario_salario.
UPDATE public.system_screens
SET views_consumidas = ARRAY['v_compliance_matriz_funcionarios']::text[],
    rpcs_chamadas = ARRAY['fn_compliance_projetar_de_ind_ponto','fn_compliance_funcionario_salario','fn_ajuda_campo_listar']::text[]
WHERE rota = '/dashboard/compliance/funcionarios'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);
