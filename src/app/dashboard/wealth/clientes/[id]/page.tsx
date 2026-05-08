import { Suspense } from "react";
import { ClienteDetalheView } from "@/components/wealth/cliente-detalhe-view";

export default async function ClienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-7xl">
      <Suspense fallback={<LoadingState />}>
        <ClienteDetalheView clienteId={id} />
      </Suspense>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div
        className="animate-spin h-8 w-8 border-4 border-t-transparent rounded-full"
        style={{ borderColor: "#C8941A", borderTopColor: "transparent" }}
      />
    </div>
  );
}
