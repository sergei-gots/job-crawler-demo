import { ListingDetailPage } from "@/widgets/listing-detail";
import { Sidebar } from "@/widgets/sidebar";

export default async function ListingDetailRoute({
  params,
}: {
  params: Promise<{ id: string; listingId: string }>;
}) {
  const { id, listingId } = await params;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <ListingDetailPage sourceId={Number(id)} listingId={Number(listingId)} />
    </div>
  );
}
