import OdontoEmptyState from '@/components/odonto/OdontoEmptyState';
import { FileText } from 'lucide-react';

export default function Page() {
  return (
    <OdontoEmptyState
      eyebrow="Clínica Odontológica · Processo"
      title="Plano de Tratamento / Orçamento"
      subtitle="Do diagnóstico ao fechamento, num fluxo só."
      Icon={FileText}
      cta="Criar plano"
      features={[
        { title: 'Plano a partir do odontograma', desc: 'Os achados viram itens de tratamento automaticamente.' },
        { title: 'Orçamento e parcelamento', desc: 'À vista, cartão ou financiamento, com simulação na hora.' },
        { title: 'Fechamento assistido (IA)', desc: 'A IA indica a melhor oferta pelo perfil de aceite.' },
        { title: 'Contrato + assinatura digital', desc: 'Gere e colete a assinatura sem papel.' },
      ]}
    />
  );
}
