-- RD-41 · Convite com escopo de AREA
-- Adiciona invites.areas_liberadas + estende fn_invite_consumido_criar_vinculo
-- pra gravar user_areas_allowed no consumo, com interseccao do teto (habilitada).
--
-- Timestamp 20260619140518 = horario REAL de criacao (UTC), posterior a
-- 20260619100000 (RD-41 owner base) e a tudo aplicado no remoto.

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS areas_liberadas text[];

COMMENT ON COLUMN public.invites.areas_liberadas IS
  'Slugs de area liberados no convite. NULL = acesso a todas as areas habilitadas da empresa.';

CREATE OR REPLACE FUNCTION public.fn_invite_consumido_criar_vinculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_areas text[];
BEGIN
  IF (OLD.is_used IS DISTINCT FROM NEW.is_used)
     AND NEW.is_used = true
     AND NEW.used_by IS NOT NULL
     AND NEW.company_id IS NOT NULL THEN

    INSERT INTO user_companies (user_id, company_id, role, created_at)
    VALUES (NEW.used_by, NEW.company_id, COALESCE(NEW.role, 'geral'), now())
    ON CONFLICT (user_id, company_id) DO UPDATE
      SET role = EXCLUDED.role;

    IF NEW.group_id IS NOT NULL THEN
      INSERT INTO user_companies (user_id, company_id, role, created_at)
      SELECT NEW.used_by, ch.company_id, COALESCE(NEW.role, 'geral'), now()
      FROM company_hierarchy ch
      WHERE ch.parent_id = NEW.group_id
         OR ch.id = NEW.group_id
      ON CONFLICT (user_id, company_id) DO NOTHING;
    END IF;

    -- Escopo de area: interseccao com o teto (areas habilitadas da empresa).
    -- Mesmo que o convite peca uma area nao contratada, ela cai aqui.
    IF NEW.areas_liberadas IS NOT NULL AND array_length(NEW.areas_liberadas, 1) > 0 THEN
      SELECT array_agg(s.area_slug) INTO v_areas
      FROM fn_empresa_areas_status(NEW.company_id) s
      WHERE s.habilitada
        AND s.area_slug = ANY(NEW.areas_liberadas);

      IF v_areas IS NOT NULL AND array_length(v_areas, 1) > 0 THEN
        INSERT INTO user_areas_allowed
          (user_id, areas_allowed, restricted, motivo, granted_by, granted_at)
        VALUES
          (NEW.used_by, v_areas, true, 'Convite com escopo de areas', NEW.created_by, now())
        ON CONFLICT (user_id) DO UPDATE
          SET areas_allowed = EXCLUDED.areas_allowed,
              restricted    = true,
              motivo        = EXCLUDED.motivo,
              granted_by    = EXCLUDED.granted_by,
              updated_at    = now();
      END IF;
    END IF;

    INSERT INTO audit_log_global (
      tabela, operacao, registro_id, dados_novos, executado_em, executado_por
    )
    VALUES (
      'user_companies', 'INSERT_VIA_INVITE', NEW.id::text,
      jsonb_build_object(
        'user_id',          NEW.used_by,
        'company_id',       NEW.company_id,
        'role',             NEW.role,
        'invite_code',      NEW.invite_code,
        'areas_liberadas',  NEW.areas_liberadas,
        'origem',           'trigger_seguranca'
      ),
      now(),
      'system'
    );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Falha ao criar vinculo user_companies para invite %: %',
                  NEW.invite_code, SQLERRM;
    RETURN NEW;
END;
$function$;
