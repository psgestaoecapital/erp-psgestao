-- Hardening da fn_revisor_classificar_mensagem (RD-103, #5458): deve ser SÓ service_role, como as irmãs do canal
-- de agentes (fn_agente_mensagem_ok_ceo, fn_agente_mensagem_responder, fn__agente_assert_servico — todas
-- postgres+service_role). O deploy deixou 'authenticated' com EXECUTE (privilégio DEFAULT do schema no CREATE),
-- fora da convenção e do que o SPEC pediu ("só service_role"). A guarda interna fn__agente_assert_servico já
-- recusa qualquer chamador com JWT (auth.uid() não-nulo → 42501), então não é buraco aberto; isto é defesa em
-- profundidade na função de GOVERNANÇA (mecanismo de aprovação) e alinhamento com as irmãs. Idempotente.
REVOKE ALL ON FUNCTION public.fn_revisor_classificar_mensagem(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_revisor_classificar_mensagem(uuid, boolean, text, text) TO service_role;
