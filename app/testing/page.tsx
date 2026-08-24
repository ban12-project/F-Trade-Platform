import Link from "next/link";

export default function TestingPage() {
  return (
    <main>
      <h1>Playwright 测试基线</h1>
      <p>该静态路由用于验证常规导航和即时导航 shell。</p>
      <Link href="/">返回首页</Link>
    </main>
  );
}
