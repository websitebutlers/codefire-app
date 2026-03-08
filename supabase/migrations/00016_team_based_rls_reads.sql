-- Migration 16: Fix RLS policies so team members can read each other's synced data.
--
-- Problem: All SELECT policies gate on user_project_ids() which requires a row
-- in project_members per-user. When User A syncs a project, only User A gets a
-- project_members row. User B (same team) can't read A's tasks/notes/docs.
--
-- Fix: Add a helper that resolves project IDs via team membership, then update
-- all read policies to allow access if the project belongs to the user's team.

-- Helper: get project IDs the user can access through their team memberships
CREATE OR REPLACE FUNCTION public.user_team_project_ids(uid uuid)
RETURNS SETOF uuid AS $$
  SELECT sp.id FROM public.synced_projects sp
  INNER JOIN public.team_members tm ON tm.team_id = sp.team_id
  WHERE tm.user_id = uid;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Synced projects: allow team members to read projects in their team
DROP POLICY IF EXISTS "projects_read" ON public.synced_projects;
CREATE POLICY "projects_read" ON public.synced_projects FOR SELECT USING (
  id IN (SELECT public.user_project_ids(auth.uid()))
  OR team_id IN (SELECT public.user_team_ids(auth.uid()))
);

-- Project members: allow team members to see who's in their team's projects
DROP POLICY IF EXISTS "project_members_read" ON public.project_members;
CREATE POLICY "project_members_read" ON public.project_members FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Project members: allow team members to add themselves to team projects
DROP POLICY IF EXISTS "project_members_manage" ON public.project_members;
CREATE POLICY "project_members_manage" ON public.project_members FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR (
    user_id = auth.uid()
    AND project_id IN (SELECT public.user_team_project_ids(auth.uid()))
  )
);

-- Synced tasks: allow team members to read tasks in their team's projects
DROP POLICY IF EXISTS "tasks_select" ON public.synced_tasks;
CREATE POLICY "tasks_select" ON public.synced_tasks FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Synced tasks: allow team members to insert tasks into their team's projects
DROP POLICY IF EXISTS "tasks_insert" ON public.synced_tasks;
CREATE POLICY "tasks_insert" ON public.synced_tasks FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Synced tasks: allow team members to update tasks in their team's projects
DROP POLICY IF EXISTS "tasks_update" ON public.synced_tasks;
CREATE POLICY "tasks_update" ON public.synced_tasks FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Synced task notes: allow team members to read task notes
DROP POLICY IF EXISTS "task_notes_select" ON public.synced_task_notes;
CREATE POLICY "task_notes_select" ON public.synced_task_notes FOR SELECT USING (
  task_id IN (
    SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_project_ids(auth.uid()))
    UNION
    SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_team_project_ids(auth.uid()))
  )
);

-- Synced task notes: allow team members to insert task notes
DROP POLICY IF EXISTS "task_notes_insert" ON public.synced_task_notes;
CREATE POLICY "task_notes_insert" ON public.synced_task_notes FOR INSERT WITH CHECK (
  task_id IN (
    SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_project_ids(auth.uid()))
    UNION
    SELECT id FROM public.synced_tasks WHERE project_id IN (SELECT public.user_team_project_ids(auth.uid()))
  )
);

-- Synced notes: allow team members to read notes in their team's projects
DROP POLICY IF EXISTS "notes_select" ON public.synced_notes;
CREATE POLICY "notes_select" ON public.synced_notes FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Synced notes: allow team members to insert notes
DROP POLICY IF EXISTS "notes_insert" ON public.synced_notes;
CREATE POLICY "notes_insert" ON public.synced_notes FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Synced notes: allow team members to update notes
DROP POLICY IF EXISTS "notes_update" ON public.synced_notes;
CREATE POLICY "notes_update" ON public.synced_notes FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Activity events: allow team members to read activity
DROP POLICY IF EXISTS "activity_read" ON public.activity_events;
CREATE POLICY "activity_read" ON public.activity_events FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Session summaries: allow team members to read summaries
DROP POLICY IF EXISTS "session_summaries_select" ON public.session_summaries;
CREATE POLICY "session_summaries_select" ON public.session_summaries FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Project docs: allow team members to read and manage docs
DROP POLICY IF EXISTS "project_docs_select" ON public.project_docs;
CREATE POLICY "project_docs_select" ON public.project_docs FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

DROP POLICY IF EXISTS "project_docs_insert" ON public.project_docs;
CREATE POLICY "project_docs_insert" ON public.project_docs FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

DROP POLICY IF EXISTS "project_docs_update" ON public.project_docs;
CREATE POLICY "project_docs_update" ON public.project_docs FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

-- Review requests: allow team members to read and manage reviews
DROP POLICY IF EXISTS "review_requests_select" ON public.review_requests;
CREATE POLICY "review_requests_select" ON public.review_requests FOR SELECT USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

DROP POLICY IF EXISTS "review_requests_insert" ON public.review_requests;
CREATE POLICY "review_requests_insert" ON public.review_requests FOR INSERT WITH CHECK (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);

DROP POLICY IF EXISTS "review_requests_update" ON public.review_requests;
CREATE POLICY "review_requests_update" ON public.review_requests FOR UPDATE USING (
  project_id IN (SELECT public.user_project_ids(auth.uid()))
  OR project_id IN (SELECT public.user_team_project_ids(auth.uid()))
);
