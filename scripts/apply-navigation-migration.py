from pathlib import Path

def change(path, old, new):
    p = Path(path)
    text = p.read_text()
    assert old in text, (path, old)
    p.write_text(text.replace(old, new))

change('components/workspace/product-panel.tsx', 'useActionState, useEffect, useRef, useState', 'useActionState, useEffect, useMemo, useRef, useState')
path = Path('components/workspace/inbound-routing-list.tsx')
text = path.read_text().replace('<div role="region" className="mb-4 space-y-3" aria-label="待分流入站消息">', '<section className="mb-4 space-y-3" aria-label="待分流入站消息">')
index = text.rfind('    </div>')
assert index >= 0
text = text[:index] + text[index:].replace('    </div>', '    </section>', 1)
path.write_text(text)
change('scripts/test-workspace-queries.ts', '  then<A = Row[], B = never>(', '  // biome-ignore lint/suspicious/noThenProperty: This deliberately models Drizzle\'s lazy thenable query execution.\n  then<A = Row[], B = never>(')
change('components/workspace/dirty-state.tsx', '  useEffect,', '  useEffect,\n  useId,')
change('components/workspace/dirty-state.tsx', '  const { setDirty } = useWorkspaceDirtyState();\n  useEffect(() => {\n    setDirty(key, dirty);\n    return () => setDirty(key, false);\n  }, [dirty, key, setDirty]);', '  const { setDirty } = useWorkspaceDirtyState();\n  const instanceId = useId();\n  useEffect(() => {\n    const registration = `${key}:${instanceId}`;\n    setDirty(registration, dirty);\n    return () => setDirty(registration, false);\n  }, [dirty, instanceId, key, setDirty]);')
change('components/workspace/workspace-link.tsx', '          router.push(href);', '          if (props.replace) router.replace(href, { scroll: props.scroll });\n          else router.push(href, { scroll: props.scroll });')
change('components/workspace/video-workspace.tsx', 'className="min-h-screen bg-muted/30"', 'className="min-h-screen bg-muted/30 pb-24"')
change('app/workspace/[projectId]/video/page.tsx', '  const projectPromise = getWorkspaceProject(projectId, session.user.id);\n  const [project, products, entries, copyCandidates] = await Promise.all([\n    projectPromise,', '  const project = await getWorkspaceProject(projectId, session.user.id);\n  if (!project || project.kind !== "marketing") notFound();\n  const [products, entries, copyCandidates] = await Promise.all([')
path = Path('app/workspace/[projectId]/video/page.tsx')
text = path.read_text()
first = text.index('  if (!project || project.kind !== "marketing") notFound();')
second = text.find('  if (!project || project.kind !== "marketing") notFound();', first + 1)
assert second >= 0
text = text[:second] + text[second:].replace('  if (!project || project.kind !== "marketing") notFound();\n', '', 1)
path.write_text(text)
change('lib/actions/workspace.ts', '    revalidatePath(`/workspace/${parsed.data.projectId}`);', '    revalidatePath(`/workspace/${parsed.data.projectId}`);\n    revalidatePath("/workspace", "layout");')
change('lib/actions/marketing-video.ts', 'revalidatePath(`/workspace/${projectId}`);', 'revalidatePath(`/workspace/${projectId}`);\n  revalidatePath("/workspace", "layout");')
print('Fixed validation diagnostics, scoped dirty registrations, layout invalidation, and video authorization ordering.')
