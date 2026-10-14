import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function IngredientesLoading() {
  return (
    <div className="mt-3 grid grid-cols-[330px_1fr] gap-[14px]">
      <div className="space-y-2 rounded-[14px] border border-[#eef0f4] bg-white p-3">
        <PageSkeleton
          height="2.25rem"
          width="100%"
          label="buscar ingrediente"
        />
        <PageSkeleton height="1.75rem" width="60%" label="filtros" />
        {Array.from({ length: 9 }, (_, i) => (
          <PageSkeleton
            key={i}
            height="2.75rem"
            width="100%"
            label="ingrediente"
          />
        ))}
      </div>
      <div className="space-y-4 rounded-[14px] border border-[#eef0f4] bg-white p-5">
        <PageSkeleton height="1.75rem" width="14rem" label="ingrediente" />
        <div className="flex gap-10">
          <PageSkeleton height="3.5rem" width="12rem" label="precio actual" />
          <PageSkeleton height="3.5rem" width="10rem" label="cambio 30 días" />
        </div>
        <PageSkeleton height="1.25rem" width="24rem" label="proveedor" />
        <PageSkeleton height="12rem" width="100%" label="se usa en" />
      </div>
    </div>
  );
}
