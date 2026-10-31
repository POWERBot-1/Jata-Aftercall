-- A role change revokes sessions atomically, including changes made outside the application.
-- Refuse version decreases so that a previously issued token cannot be revived accidentally.
CREATE FUNCTION "user_guard_session_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sessionVersion" < OLD."sessionVersion" THEN
    RAISE EXCEPTION 'Session version cannot decrease';
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role" AND NEW."sessionVersion" = OLD."sessionVersion" THEN
    NEW."sessionVersion" := OLD."sessionVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_guard_session_version"
BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "user_guard_session_version"();
