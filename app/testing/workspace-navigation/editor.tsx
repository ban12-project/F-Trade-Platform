"use client";
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkspaceDirtyProvider, useWorkspaceDirty } from '@/components/workspace/dirty-state';
import { WorkspaceLink } from '@/components/workspace/workspace-link';
function Editor({ href }: { href: string }) {
  const [value, setValue] = useState('');
  useWorkspaceDirty('navigation-fixture', value.length > 0);
  return <div className="space-y-4 p-6"><Label htmlFor="navigation-draft">测试草稿</Label><Input id="navigation-draft" value={value} onChange={(event) => setValue(event.target.value)} /><WorkspaceLink href={href} prefetch={false}>切换测试页面</WorkspaceLink></div>;
}
export function NavigationEditor({ href }: { href: string }) {
  // A nested standalone-page provider must reuse the layout's guard rather than hide dirty state.
  return <WorkspaceDirtyProvider><Editor href={href} /></WorkspaceDirtyProvider>;
}
