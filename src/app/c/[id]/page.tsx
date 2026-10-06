import { FanPledgePage } from "@/components/FanPledgePage";

export const metadata = {
  title: "Bring the tour to your city: Fanroute",
  description: "Pledge for the city you want. It's a hold, not a charge, until the show is confirmed.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FanPledgePage id={id} />;
}
