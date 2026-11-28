-- Hub · §315 C-2 (Memorial descritivo e especificação técnica por serviço da EAP)
-- Blueprint vivo hub_projetos tela 315, linha essencial "Memorial descritivo e especificação técnica
-- por serviço da EAP (o que, como, material e norma)". O "o que" já é a descrição do serviço e o
-- "material" é a composição (BOM); faltavam o "como" (método/especificação de execução) e a "norma".
--
-- Aditiva e idempotente: só acrescenta duas colunas de texto, opcionais, à ficha do serviço do Hub
-- (projetos_servicos). Nenhuma alteração de estrutura existente, de cálculo, de RLS ou de grants —
-- a tabela já tem RLS por empresa ligada; colunas novas herdam a mesma guarda. Nada de dado de cliente
-- é tocado. fn_projetos_servico_completo devolve o serviço via to_jsonb(s.*), então as colunas novas
-- fluem para a tela sem mexer na RPC.

ALTER TABLE public.projetos_servicos
  ADD COLUMN IF NOT EXISTS especificacao_tecnica text,
  ADD COLUMN IF NOT EXISTS norma_referencia text;

COMMENT ON COLUMN public.projetos_servicos.especificacao_tecnica IS
  'Memorial descritivo (§315): como o serviço é executado — método, sequência, materiais e cuidados técnicos.';
COMMENT ON COLUMN public.projetos_servicos.norma_referencia IS
  'Memorial descritivo (§315): norma técnica ou especificação de referência que o serviço deve seguir.';

-- Ajuda de campo (RD-95) dos dois campos novos da Ficha do serviço. Idempotente por chave.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.catalogo.servico.especificacao_tecnica','/dashboard/projetos/catalogo/[id]','Ficha do serviço','Especificação técnica',
  'Como o serviço é executado: método, sequência, materiais e cuidados técnicos.',
  'Forma o memorial descritivo do serviço — orienta a equipe na obra e embasa o orçamento e a medição.',
  'Assentamento com argamassa colante AC-III, juntas de 2 mm, rejunte flexível; cura mínima de 72 h.',
  'Deixar vago ou repetir só o nome do serviço, sem o "como fazer".','projetos',90,'publicado'),
 ('projetos.catalogo.servico.norma_referencia','/dashboard/projetos/catalogo/[id]','Ficha do serviço','Norma de referência',
  'Norma técnica ou especificação que o serviço deve seguir.',
  'Registra a norma aplicável para conferência de qualidade e defesa técnica do serviço.',
  'ABNT NBR 13753; ABNT NBR 15575.',
  'Informar lei genérica no lugar da norma técnica do serviço.','projetos',100,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum, vertical=EXCLUDED.vertical,
  ordem=EXCLUDED.ordem, status=EXCLUDED.status;

-- Blueprint vivo (CEO 21/11): a linha §315 do memorial descritivo passa a PARCIAL — a ficha do serviço
-- ganha "como" (especificação técnica) e "norma"; falta ainda surfacar o memorial no item do orçamento.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='Hub §315 memorial · /dashboard/projetos/catalogo/[id] · especificação técnica + norma na ficha do serviço'
 WHERE id='3dcf71c7-ba98-4f51-a4f4-8d94149c41e2'
   AND status_baseline <> 'atendido';
