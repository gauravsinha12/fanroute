import { FanPledgePage } from "@/components/FanPledgePage";

export const metadata = {
  title: "Bring the tour to your city: Fanroute",
  description: "Pledge for the city you want. It's a hold, not a charge, until the show is confirmed.",
};

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ city?: string }> }) {
  const { id } = await params;
  const { city } = await searchParams;
  // ?city=<marketId> opens straight on that city's pledge, e.g. from a voice assistant's link.
  return <FanPledgePage id={id} initialCity={typeof city === "string" ? city : null} />;
}
