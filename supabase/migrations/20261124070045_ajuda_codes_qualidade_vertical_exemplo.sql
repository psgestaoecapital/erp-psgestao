-- RD-38: o exemplo do "?" da chave dev.codes.qualidade_vertical trazia números
-- do momento ("Hub ... nota média 48 · 0% prontas") que já estão errados — o Hub
-- real tem nota ~96 e ~75% prontas. Número de instante envelhece e vira mentira na
-- ajuda. Troca por um exemplo ilustrativo SEM números do momento (só DADO, aditiva,
-- idempotente — só o campo exemplo desta chave).
UPDATE public.erp_ajuda_campo
   SET exemplo = 'Exemplo: construído 26% = 89 requisitos atendidos + 215 parciais de 751. Vertical sem blueprint aparece só com nota e prontas.',
       atualizado_em = now()
 WHERE chave = 'dev.codes.qualidade_vertical';
