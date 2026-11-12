-- Mão de Obra (Indústria) · /dashboard/industrial/mao-obra
-- RD-95 (aud8 84/95): completar o "?" em indicador e ação que ainda não tinham.
--   - industrial.mao_obra.setores  → indicador "Setores" (quantos setores com pessoas na competência)
--   - industrial.mao_obra.importar → ação "Importar / atualizar folha"
-- Texto em linguagem do usuário (o que é / para que serve / exemplo / erro comum). Chaves lidas por
-- fn_ajuda_campo_listar (uma chamada por tela). Idempotente (ON CONFLICT (chave) DO UPDATE).
-- Metadado de ajuda — NÃO toca dado de cliente, função, RLS nem regra fiscal/financeira. Faixa :47.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('industrial.mao_obra.setores',
   '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Setores',
   'Indicador calculado — você não preenche.',
   'Conta quantos setores têm pessoas na competência selecionada (pró-labore e "sem setor" não entram nesta contagem de setores produtivos).',
   '3 setores · Abate, Desossa, Expedição',
   'Setor faltando? Confira o setor da matrícula no cadastro de pessoas e reimporte/atualize a folha.',
   'industrial', 6, 1, 'publicado'),
  ('industrial.mao_obra.importar',
   '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Importar / atualizar folha',
   'Ação — abre a tela de importação da folha.',
   'Leva à tela de Folha para subir ou atualizar a planilha da competência. O custo por setor e a lista de pessoas desta tela vêm dessa folha importada.',
   'Clique, selecione a competência e envie a planilha da folha.',
   'Custo desatualizado? É porque a folha da competência ainda não foi importada/atualizada aqui.',
   'industrial', 7, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status,
  atualizado_em = now();
