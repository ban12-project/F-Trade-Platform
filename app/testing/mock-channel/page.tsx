import { notFound } from "next/navigation";

import { MockChannelClient } from "./mock-channel-client";

export default function MockChannelPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <MockChannelClient />;
}
