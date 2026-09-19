"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductEvidencePreview } from "@/lib/product/evidence-preview";
import { productFactLabels } from "@/lib/product/fact-labels";

export function ProductEvidenceSources({ sources }: { sources: ProductEvidencePreview[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>对照来源原件</CardTitle>
        <CardDescription>
          只显示当前项目已绑定、且支持这些字段的来源。资料原件不会公开。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sources.length ? (
          sources.map((source) => (
            <section key={source.id} className="flex flex-col gap-3" aria-label={source.label}>
              <p className="break-words text-sm">{source.label}</p>
              <Button
                variant="outline"
                render={<a href={source.href} target="_blank" rel="noopener noreferrer" />}
              >
                打开来源原件（新窗口）
              </Button>
              <p className="text-sm text-muted-foreground">
                关联字段（仍需人工核实）：
                {source.fields
                  .map((field) => productFactLabels[field.path] ?? field.path)
                  .join("、")}
              </p>
              {!source.fields.some((field) => field.excerpt) ? (
                <p className="text-sm text-muted-foreground">
                  未保留可直接展示的原文片段，请对照上方原件。
                </p>
              ) : null}
              {source.fields
                .filter((field) => field.excerpt)
                .map((field) => (
                  <div key={field.path} className="flex flex-col gap-2">
                    <p className="text-sm font-medium">
                      {productFactLabels[field.path] ?? field.path}
                    </p>
                    {field.excerpt ? (
                      <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
                        {field.excerpt}
                      </blockquote>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        未保留可直接展示的原文片段，请对照上方原件。
                      </p>
                    )}
                  </div>
                ))}
            </section>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            当前项目中没有可打开的对应原件。请由资料编辑者核对来源归属或补充资料；现有证据引用仍保留在字段中。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
