import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FailureTrigger } from "./client";

async function Content() {
  const cookieStore = await cookies();
  if (cookieStore.get("synthetic-error-recovery")?.value === "fail") {
    throw new Error("SYNTHETIC_PRIVATE_SERVER_DETAIL");
  }
  return (
    <main id="main-content" className="p-6">
      <h1>合成页面已加载</h1>
      <FailureTrigger />
    </main>
  );
}
export default function Page() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={<p>正在读取合成页面</p>}>
      <Content />
    </Suspense>
  );
}
