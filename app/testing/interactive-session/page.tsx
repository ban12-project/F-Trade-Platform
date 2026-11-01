import { notFound } from "next/navigation";
import { InteractiveSessionFixture } from "./fixture";

export default function Page() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <InteractiveSessionFixture />;
}
