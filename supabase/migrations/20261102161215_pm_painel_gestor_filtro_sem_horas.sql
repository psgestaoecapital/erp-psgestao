-- RD-95 (CEO 08/10): "?" (AjudaCampo) no novo filtro da lista "Jobs em andamento sem horas"
-- de /dashboard/pm/painel-gestor. O auditor (aud8 86/95) apontou a lista extensa (46 jobs) sem
-- filtro; esta entrega adiciona busca + filtro por responsável à lista e cadastra a chave de ajuda
-- do filtro em erp_ajuda_campo (fonte única lida por fn_ajuda_campo_listar).
-- Aditiva, idempotente (chave é única). Code: dev7claudeps
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  ('pm.painel_gestor.filtro_sem_horas', '/dashboard/pm/painel-gestor', 'Painel do gestor', 'pm',
   'Filtrar jobs sem horas',
   'Digite parte do código ou do título do job para encontrá-lo na lista, e/ou escolha um responsável para ver só os jobs dele.',
   'Ajuda a achar rápido o job certo quando há muitos jobs em andamento sem apontamento, sem precisar rolar a lista inteira.',
   'Digitar "verão" mostra só os jobs cujo título ou código contém "verão"; escolher uma pessoa mostra só os jobs dela.',
   'Esquecer de limpar o filtro: a lista parece menor do que é — o contador do título mostra o total real sem filtro.',
   60, 'publicado')
ON CONFLICT (chave) DO NOTHING;
