-- RD-98 p3 (origem do dado): classifica /dashboard/cadastros/clientes/importar.
-- A tela ja tinha TODAS as fontes registradas, mas seguia estado_real='desconhecida'. So
-- metadado de registro da tela — NAO altera comportamento, dado de cliente, RLS nem grants.
--
-- Fontes conferidas no codigo (RD-38): a pagina delega ao componente
-- src/components/cadastros/ImportarCadastrosView.tsx, que chama rpc fn_cadastro_importar_previa,
-- fn_cadastro_importar_aplicar e usa AjudaCampo (fn_ajuda_campo_listar, fn_ajuda_campo_uso) —
-- todas ja presentes no registro (view erp_lancamentos tambem).
-- Nada falta -> apenas classifica estado_real='parcial' SO enquanto ainda 'desconhecida'.
-- ADITIVA e IDEMPOTENTE: reaplicar nao altera nada.
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/cadastros/clientes/importar'
   AND estado_real = 'desconhecida';
