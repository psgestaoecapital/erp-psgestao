// Mão de obra compartilhada (CEO 03/10) — URL /dashboard/_compartilhado/mao-obra?area=pm|industrial|oficina|odonto|agro|gestao_empresarial.
// A pasta se chama "%5Fcompartilhado" porque no App Router uma pasta que começa com "_" é PRIVADA (fica fora das rotas);
// "%5F" é o "_" codificado e vira "/_compartilhado" na URL (node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md).
// A mesma tela do Hub (/dashboard/projetos/mao-obra); a área da rota escolhe as funções-modelo.
import MaoObraTela from "@/components/mao-obra/MaoObraTela";

export default async function MaoObraCompartilhadaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const area = Array.isArray(sp.area) ? sp.area[0] : sp.area;
  return <MaoObraTela area={area ?? null} />;
}
