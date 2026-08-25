import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>F-Trade Platform</h1>
      <p>离合器外贸工作流 MVP。</p>
      <Link href="/auth">登录或注册</Link>
      <Link href="/console/products">产品目录</Link>
      <Link href="/testing">查看测试页面</Link>
    </main>
  );
}
