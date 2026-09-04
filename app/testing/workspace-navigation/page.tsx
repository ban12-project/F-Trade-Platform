import { notFound } from 'next/navigation';
import { navigationProject } from './data';
import { NavigationEditor } from './editor';
export default function Page() {
  if (process.env.NEXT_ENABLE_TESTING_API !== '1') notFound();
  return <main className="min-h-screen pb-24"><h1>导航测试起点</h1><NavigationEditor href={`/testing/workspace-navigation/${navigationProject.id}?slow=1`} /></main>;
}
