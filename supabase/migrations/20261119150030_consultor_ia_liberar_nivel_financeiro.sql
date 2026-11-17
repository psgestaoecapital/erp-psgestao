-- CEO 17/11 (RD-25): liberar o Consultor IA para o nível 'financeiro' (Júlia). O #5339 já ligou o porteiro
-- de custo (US$2/dia); faltava este gate de acesso (permissoes_nivel). Aditivo/reversível; só este nível.
-- Não altera dado de cliente; não toca outros níveis (comercial/coordenador seguem sem ver).
UPDATE public.permissoes_nivel SET pode_ver = true
 WHERE modulo_id = 'consultor_ia' AND nivel = 'financeiro';
-- Reversível: UPDATE public.permissoes_nivel SET pode_ver = false WHERE modulo_id='consultor_ia' AND nivel='financeiro';
