-- Hub HB2 · Calculadora de Obra PS — 3º sistema: revestimento colado (Parte O). Só amplia o CHECK do de-para; sem dado alterado.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.erp_calc_depara'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%sistema%' LOOP
    EXECUTE format('ALTER TABLE public.erp_calc_depara DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE public.erp_calc_depara
    ADD CONSTRAINT erp_calc_depara_sistema_check CHECK (sistema IN ('parede', 'forro_f530', 'revestimento_colado'));
END $$;
