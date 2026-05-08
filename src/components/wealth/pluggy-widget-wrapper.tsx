"use client";

import dynamic from "next/dynamic";

const PluggyConnect = dynamic(
  () => import("react-pluggy-connect").then((m) => m.PluggyConnect),
  { ssr: false }
);

interface PluggyItemSuccessData {
  item: {
    id: string;
    connector: { id: number; name: string; type?: string };
  };
}

interface PluggyWidgetWrapperProps {
  connectToken: string;
  onSuccess: (itemData: PluggyItemSuccessData) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
}

export function PluggyWidgetWrapper({
  connectToken,
  onSuccess,
  onError,
  onClose,
}: PluggyWidgetWrapperProps) {
  return (
    <PluggyConnect
      connectToken={connectToken}
      includeSandbox={true}
      onSuccess={onSuccess as never}
      onError={onError as never}
      onClose={onClose}
    />
  );
}
