from src.db.manager import DatabaseManager


def test_session_repository_round_trip(tmp_path):
    db = DatabaseManager(str(tmp_path / "test.db"))

    session = db.session.create_session(
        session_type="chat",
        title="Repo test",
        settings={"mode": "basic"},
    )
    message = db.session.add_message(
        session["session_id"],
        role="user",
        content="hello",
        metadata={"source": "test"},
    )
    hydrated = db.session.get_session_with_messages(session["session_id"])

    assert hydrated is not None
    assert hydrated["settings"]["mode"] == "basic"
    assert hydrated["messages"][0]["content"] == "hello"
    assert message["session_id"] == session["session_id"]

    db.close()


def test_session_repository_supports_backfill_ids_and_timestamps(tmp_path):
    db = DatabaseManager(str(tmp_path / "backfill.db"))

    session = db.session.create_session(
        session_type="teacher",
        session_id="teacher_backfill_1",
        title="Backfilled session",
        settings={"subject": "science"},
        created_at=1700000000,
        updated_at=1700000005,
    )
    message = db.session.add_message(
        "teacher_backfill_1",
        role="assistant",
        content="Backfilled message",
        metadata={"imported": True},
        message_id="msg_backfill_1",
        created_at=1700000001,
        touch_session=False,
    )
    hydrated = db.session.get_session_with_messages("teacher_backfill_1")

    assert session["session_id"] == "teacher_backfill_1"
    assert message["message_id"] == "msg_backfill_1"
    assert hydrated is not None
    assert hydrated["created_at"].startswith("2023")
    assert hydrated["messages"][0]["created_at"].startswith("2023")

    db.close()
