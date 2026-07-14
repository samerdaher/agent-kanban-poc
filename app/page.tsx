import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { listWorkspaces, createWorkspace, seedWorkspace } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const workspaces = listWorkspaces(user.id);
  if (workspaces.length === 0) {
    const ws = createWorkspace('My Workspace', user.id);
    seedWorkspace(ws.id, user.id);
    redirect(`/w/${ws.id}`);
  }
  redirect(`/w/${workspaces[0].id}`);
}
