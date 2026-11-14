-- #135 (ajuste 21/10, item 6) · fotos da oficina em LOTE (recepção/checklist, diagnóstico, execução e ficha da OS).
-- ADITIVA: (1) função NOVA fn_oficina_registro_legenda — troca só a legenda (descricao) de uma foto da OS, com a mesma
-- guarda por empresa de fn_os_foto_excluir; (2) textos do "?" (RD-95) dos botões de foto e da legenda.
-- Sem tabela nova, sem mudança de policy e sem UPDATE/DELETE em massa de dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_oficina_registro_legenda(p_id uuid, p_descricao text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_etapa text; v_desc text;
BEGIN
  SELECT company_id, etapa INTO v_company, v_etapa FROM erp_os_registro_foto WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'foto_inexistente');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- legenda é opcional: vazia volta ao texto padrão da etapa (a coluna é obrigatória e aparece na impressão)
  v_desc := left(NULLIF(trim(coalesce(p_descricao, '')), ''), 200);
  IF v_desc IS NULL THEN
    v_desc := CASE v_etapa WHEN 'diagnostico' THEN 'Foto do diagnóstico' WHEN 'recepcao' THEN 'Foto da recepção' ELSE 'Foto do serviço' END;
  END IF;
  UPDATE erp_os_registro_foto SET descricao = v_desc WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'descricao', v_desc);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_oficina_registro_legenda(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_registro_legenda(uuid, text) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Oficina', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'oficina', 'publicado'
FROM (VALUES
  ('oficina.recepcao.fotos_enviar', '/dashboard/oficina/recepcao', 'Fotos de como chegou', 1,
   '"Câmera" tira uma foto na hora. "Galeria / arquivos (várias)" deixa escolher várias fotos de uma vez, no computador ou no celular.',
   'Guarda o estado do veículo na entrada (riscos, amassados, painel). As fotos ficam na OS e saem no histórico fotográfico da impressão.',
   'Selecione as 10 fotos do carro na galeria: cada uma mostra a sua barra de progresso e vira miniatura com legenda.',
   'Fechar a tela antes de terminar o envio. Se alguma foto não subir, o aviso diz qual: envie só essa de novo.'),
  ('oficina.diagnostico.fotos_enviar', '/dashboard/oficina/diagnostico', 'Fotos do diagnóstico', 1,
   '"Câmera" tira uma foto; "Galeria / arquivos (várias)" escolhe várias de uma vez. Em "Foto do item", as fotos ficam ligadas àquele item.',
   'Mostra ao cliente o defeito encontrado. As fotos entram no orçamento enviado pelo WhatsApp e no histórico fotográfico da impressão.',
   'Pastilha gasta, vazamento e pneu careca: selecione as três fotos de uma vez na galeria.',
   'Esperar uma foto subir para escolher a próxima: agora dá para escolher todas juntas.'),
  ('oficina.diagnostico.foto_legenda', '/dashboard/oficina/diagnostico', 'Legenda da foto', 2,
   'Escreva, se quiser, o que a foto mostra. Vale ao sair do campo. Em branco, fica "Foto do diagnóstico".',
   'A legenda aparece embaixo da foto na impressão da OS e no orçamento do cliente.',
   'Pastilha dianteira com 2 mm.',
   'Escrever valor na legenda: o preço vai no item do orçamento, não na foto.'),
  ('oficina.patio.fotos_enviar', '/dashboard/oficina/patio', 'Registro fotográfico do serviço', 1,
   '"Câmera" tira uma foto; "Galeria / arquivos (várias)" escolhe várias de uma vez. Cada foto já fica ligada à OS.',
   'Prova o serviço feito (peça trocada, antes e depois). Aparece no histórico fotográfico da impressão da OS.',
   'Peça velha e peça nova instalada: selecione as duas fotos de uma vez.',
   'Deixar a foto sem legenda quando o serviço não é óbvio: escreva na linha abaixo da miniatura.'),
  ('oficina.patio.foto_legenda', '/dashboard/oficina/patio', 'Legenda da foto', 2,
   'Escreva, se quiser, o que a foto mostra. Vale ao sair do campo. Em branco, fica "Foto do serviço".',
   'A legenda aparece embaixo da foto na impressão da OS.',
   'Correia dentada nova instalada.',
   'Escrever valor ou hora na legenda: horas vão no apontamento.'),
  ('oficina.os.fotos_enviar', '/dashboard/os', 'Fotos da OS', 30,
   '"Câmera" tira uma foto; "Galeria / arquivos (várias)" escolhe várias de uma vez (computador ou celular). Cada foto já fica ligada à OS.',
   'Guarda as fotos do atendimento na própria OS, sem passar pela recepção nem pelo diagnóstico. Saem no histórico fotográfico da impressão.',
   'Selecione 10 fotos de uma vez: todas sobem com progresso e viram miniaturas. Se uma falhar, as outras ficam salvas e o aviso diz qual faltou.',
   'Fechar a OS antes de terminar o envio. A foto que não subiu precisa ser enviada de novo.'),
  ('oficina.os.foto_legenda', '/dashboard/os', 'Legenda da foto', 31,
   'Escreva, se quiser, o que a foto mostra. Vale ao sair do campo. Em branco, fica "Foto do serviço". O "x" da miniatura exclui a foto.',
   'A legenda aparece embaixo da foto na impressão da OS.',
   'Motor lavado antes da entrega.',
   'Excluir a foto errada: a exclusão tira a foto também da impressão.')
) AS v(chave, rota, rotulo, ordem, o_que, para_que, exemplo, erro)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
