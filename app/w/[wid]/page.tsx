import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getWorkspaceRole, listWorkspaces, getWorkspaceMeta } from '@/lib/store';
import WorkspaceApp from '@/components/WorkspaceApp';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!getWorkspaceRole(wid, user.id) || !getWorkspaceMeta(wid)) redirect('/');
  return <WorkspaceApp workspaceId={wid} user={user} workspaces={listWorkspaces(user.id)} />;
}
