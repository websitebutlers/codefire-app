-- Auto-populate activity_events from synced table changes

-- Task created
CREATE OR REPLACE FUNCTION public.on_synced_task_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.activity_events (project_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    NEW.project_id,
    NEW.created_by,
    'task_created',
    'task',
    NEW.id,
    jsonb_build_object('title', NEW.title, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_synced_task_insert
  AFTER INSERT ON public.synced_tasks
  FOR EACH ROW EXECUTE FUNCTION public.on_synced_task_insert();

-- Task completed
CREATE OR REPLACE FUNCTION public.on_synced_task_completed()
RETURNS trigger AS $$
BEGIN
  IF OLD.status != 'done' AND NEW.status = 'done' THEN
    INSERT INTO public.activity_events (project_id, user_id, event_type, entity_type, entity_id, metadata)
    VALUES (
      NEW.project_id,
      NEW.created_by,
      'task_completed',
      'task',
      NEW.id,
      jsonb_build_object('title', NEW.title)
    );
  ELSIF OLD.status != NEW.status THEN
    INSERT INTO public.activity_events (project_id, user_id, event_type, entity_type, entity_id, metadata)
    VALUES (
      NEW.project_id,
      NEW.created_by,
      'task_updated',
      'task',
      NEW.id,
      jsonb_build_object('title', NEW.title, 'status', NEW.status, 'old_status', OLD.status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_synced_task_completed
  AFTER UPDATE ON public.synced_tasks
  FOR EACH ROW EXECUTE FUNCTION public.on_synced_task_completed();

-- Note created
CREATE OR REPLACE FUNCTION public.on_synced_note_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.activity_events (project_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    NEW.project_id,
    NEW.created_by,
    'note_created',
    'note',
    NEW.id,
    jsonb_build_object('title', NEW.title)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_synced_note_insert
  AFTER INSERT ON public.synced_notes
  FOR EACH ROW EXECUTE FUNCTION public.on_synced_note_insert();

-- Session summary shared
CREATE OR REPLACE FUNCTION public.on_session_summary_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.activity_events (project_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    NEW.project_id,
    NEW.user_id,
    'session_shared',
    'session_summary',
    NEW.id,
    jsonb_build_object('summary', LEFT(NEW.summary, 120), 'model', NEW.model, 'git_branch', NEW.git_branch)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_session_summary_insert
  AFTER INSERT ON public.session_summaries
  FOR EACH ROW EXECUTE FUNCTION public.on_session_summary_insert();

-- Project member added
CREATE OR REPLACE FUNCTION public.on_project_member_insert()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.activity_events (project_id, user_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    NEW.project_id,
    NEW.user_id,
    'member_joined',
    'project_member',
    NEW.user_id,
    jsonb_build_object('role', NEW.role)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_project_member_insert
  AFTER INSERT ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.on_project_member_insert();
