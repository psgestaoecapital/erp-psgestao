// src/app/dashboard/bpo/supervisao/page.tsx
//
// Redirect cirurgico: /dashboard/bpo/supervisao -> /dashboard/bpo/supervisor
//
// Existencia: criado em 12/05/2026 como fix de regressao BPO detectada pelo
// Insight Auditor IA. /dashboard/bpo/supervisao tinha score 0 enquanto
// /dashboard/bpo/supervisor estava com score 75 funcional. Diagnostico:
// menu/link apontava para /supervisao (sem "r" final) e a pagina real
// vive em /supervisor.
//
// Decisao senior (Cenario B Secao 7): fix mais conservador possivel —
// Server Component minimo com redirect imediato. Sem state, sem
// dependencias, zero risco de quebrar nada. UX transparente para o
// usuario (passou direto sem ver). Atende Pilar 3 (Facilidade de Uso).

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SupervisaoRedirect() {
  redirect('/dashboard/bpo/supervisor');
}
