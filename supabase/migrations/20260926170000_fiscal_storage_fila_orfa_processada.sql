-- GE-F7 higiene (decisao CEO 26/09): as 13 linhas da classe arquivadas_fila_orfa passam a processado=true.
-- Sao NF-e da KGF (a462e13f) cujo XML JA esta guardado — no bucket fiscal-nfe-xml (fluxo de arquivamento
-- de NF-e separado, 24/09 07:50), com xml_storage_path no formato <empresa>/<chave>.xml — mas a fila
-- erp_fiscal_storage_queue nunca foi marcada. Prova 26/09 11:05: 13/13 objetos existem (6,4-7,3 KB).
-- Guarda extra alem da classe: so marca se o objeto EXISTE em storage.objects (qualquer bucket) — num
-- replay, uma linha cujo arquivo sumiu nao vira "processada" (RD-38/RD-51). Hoje: mesmas 13 linhas.
-- Sem DELETE, sem mexer em doc (RD-30). DANFE dessas 13 nao esta guardado (so XML, o que o SINIEF exige).

UPDATE public.erp_fiscal_storage_queue q
   SET processado = true,
       processado_em = now()
 WHERE NOT q.processado
   AND EXISTS (
     SELECT 1
       FROM public.erp_nfe_emitidas e
       JOIN storage.objects o ON o.name = e.xml_storage_path
      WHERE q.tabela = 'nfe' AND e.id = q.doc_id AND e.xml_storage_path IS NOT NULL
     UNION ALL
     SELECT 1
       FROM public.erp_nfse_emitidas n
       JOIN storage.objects o ON o.name = n.xml_storage_path
      WHERE q.tabela = 'nfse' AND n.id = q.doc_id AND n.xml_storage_path IS NOT NULL
   );
