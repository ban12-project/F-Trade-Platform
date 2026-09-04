import { ArrowLeftIcon, FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TestingPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-svh items-center justify-center bg-muted/30 p-4 md:p-8"
    >
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">测试基线</Badge>
            <FlaskConicalIcon aria-hidden="true" className="text-muted-foreground" />
          </div>
          <CardTitle>
            <h1>Playwright 测试基线</h1>
          </CardTitle>
          <CardDescription>该静态路由用于验证常规导航和即时导航的静态页面框架。</CardDescription>
        </CardHeader>
        <CardContent>
          <LinkButton href="/" variant="outline">
            <ArrowLeftIcon data-icon="inline-start" />
            返回首页
          </LinkButton>
        </CardContent>
      </Card>
    </main>
  );
}
