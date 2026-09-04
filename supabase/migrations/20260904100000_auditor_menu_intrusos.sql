-- Auditor dos "intrusos" do menu da Indústria (pedido do CEO: auditor, NÃO allowlist).
--
-- O problema recorreu 2× (migrations de julho): um módulo SHARED com 'industrial' em surface_in_groups
-- aparece no menu da Indústria mesmo sendo de outra área (financeiro/CRM/análises). Remoção manual é
-- conserto que expira. O CEO prefere um ALERTA (avisa sem travar quem tem motivo legítimo) a uma
-- allowlist curada (que vira mais uma lista pra esquecer).
--
-- Regra: alerta quando um módulo shared surfa na Indústria e NÃO é de administração (admin é
-- transversal legítimo — aparece em todo lugar por natureza, não é intruso). Idempotente: não repete
-- alerta aberto nem re-alerta o que o CEO já dispensou (dispensar = "esse é legítimo, não me avise").
-- Reusa erp_alerta_proativo. Alerta é de PLATAFORMA → cai na empresa da PS (surface_in_groups é global).

CREATE OR REPLACE FUNCTION public.fn_auditar_menu_intrusos()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ps uuid := '25305b15-09e1-4abe-944f-9bff31743350'; -- PS GESTAO & CAPITAL (dona da plataforma)
  r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT mc.id, mc.nome, mc.grupo, mc.subgrupo
    FROM module_catalog mc
    WHERE mc.is_shared = true AND mc.ativo = true AND mc.legacy = false
      AND 'industrial' = ANY(mc.surface_in_groups)
      AND mc.grupo <> 'industrial'
      AND COALESCE(mc.subgrupo, '') <> 'administracao'   -- admin é transversal legítimo, não intruso
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM erp_alerta_proativo a
      WHERE a.company_id = v_ps AND a.tipo = 'menu_intruso_industrial'
        AND a.contexto->>'modulo_id' = r.id
        AND (a.dispensado = true OR a.resolvido = false)   -- já dispensado (legítimo) ou já aberto
    ) THEN
      INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
      VALUES (v_ps, 'menu_intruso_industrial', 'media',
        'Módulo fora de lugar no menu da Indústria',
        'O módulo "' || r.nome || '" (área ' || COALESCE(r.grupo, '?') ||
          ') está surgindo no menu da Indústria via surface_in_groups. Se não é operação de planta, ' ||
          'remova ''industrial'' do surface_in_groups (NÃO desative o módulo — ele segue nas outras áreas). ' ||
          'Se é legítimo, dispense este alerta e ele não volta.',
        jsonb_build_object('modulo_id', r.id, 'nome', r.nome, 'grupo', r.grupo, 'subgrupo', r.subgrupo),
        '/dashboard/admin/menu');
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'novos_alertas', v_n);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_auditar_menu_intrusos() TO authenticated, service_role;

-- Agenda diária (06:10). Idempotente: desagenda se já existir antes de reagendar.
DO $$ BEGIN PERFORM cron.unschedule('auditar-menu-intrusos-industrial'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('auditar-menu-intrusos-industrial', '10 6 * * *', $$SELECT public.fn_auditar_menu_intrusos();$$);

-- Roda uma vez no deploy pra fotografar o estado atual (hoje = limpo, 0 alertas esperados).
SELECT public.fn_auditar_menu_intrusos();
