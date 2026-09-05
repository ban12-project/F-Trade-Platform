import { notFound } from "next/navigation";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { MarketingVideoCreateForm } from "@/components/workspace/marketing-video-create-form";
import type { ReadyVideoProductSourceWithMedia } from "@/lib/video/product-media-sources";

const products: ReadyVideoProductSourceWithMedia[] = [
  {
    id: "00000000-0000-4000-8000-000000000901",
    productName: "Verified clutch kit",
    internalSku: "SYN-901",
    factOptions: [
      { value: "product.product_name", label: "product.product_name" },
      { value: "product.oe_numbers", label: "product.oe_numbers" },
    ],
    mediaOptions: [
      {
        id: "00000000-0000-4000-8000-000000000902",
        mediaType: "image",
        role: "product_hero",
        description: "Approved synthetic front product image.",
        width: 1600,
        height: 1600,
        durationMs: null,
        hasAudio: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000903",
        mediaType: "video",
        role: "inspection",
        description: "Approved synthetic inspection clip.",
        width: 1080,
        height: 1920,
        durationMs: 4_500,
        hasAudio: false,
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000904",
    productName: "Verified clutch disc",
    internalSku: "SYN-904",
    factOptions: [{ value: "product.product_name", label: "product.product_name" }],
    mediaOptions: [],
  },
];

/** Test-only fixture; production product and media access remains server-authorized. */
export default function VideoProductMediaCreateTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <WorkspaceDirtyProvider>
        <MarketingVideoCreateForm
          projectId="00000000-0000-4000-8000-000000000900"
          products={products}
        />
      </WorkspaceDirtyProvider>
    </main>
  );
}
